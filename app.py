from flask import Flask, render_template, request, redirect, session, jsonify
from kiteconnect import KiteConnect, KiteTicker
from dotenv import load_dotenv
import os
import logging
from flask_socketio import SocketIO, emit
import threading
import time
from functools import wraps

# Ensure logs directory exists
log_dir = os.path.join(os.getcwd(), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file_path = os.path.join(log_dir, "pyalgo.log")

# Configure THIS module's logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

if not logger.handlers:
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_formatter)
    logger.addHandler(console_handler)

    try:
        file_handler = logging.FileHandler(log_file_path)
        file_handler.setFormatter(log_formatter)
        logger.addHandler(file_handler)
        logger.info(f"File logging configured to {log_file_path}.")
    except PermissionError:
        logger.warning(f"Permission denied for log file {log_file_path}. File logging is disabled.")
    except Exception as e:
        logger.warning(f"Failed to set up file logging for {log_file_path} due to: {e}. File logging is disabled.")
else:
    logger.info("Logger already has handlers. Skipping basic handler setup.")

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET_KEY')
socketio = SocketIO(app)

# Kite API Configuration
api_key = os.getenv('KITE_API_KEY')
api_secret = os.getenv('KITE_API_SECRET')
redirect_uri = os.getenv('REDIRECT_URI')

# Global WebSocket client and thread for the dashboard chart
kws_ticker = None
dashboard_ws_thread = None
subscribed_tokens = set()
instrument_map = {}

def get_kite_instance():
    access_token = get_access_token()
    if not access_token:
        return None
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)
    return kite

def get_access_token():
    return session.get('kite_access_token')

def require_login(f):
    """
    Decorator to ensure user is logged in before accessing protected routes
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not get_access_token():
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated_function

def kite_websocket_task(access_token_ws, public_token_ws, symbols_to_subscribe_tokens):
    global kws_ticker, subscribed_tokens
    logger.info(f"Kite WebSocket task starting for tokens: {symbols_to_subscribe_tokens}")

    kws_ticker = KiteTicker(api_key, access_token_ws)

    def on_ticks(ws, ticks):
        logger.debug(f"Ticks received: {ticks}")
        socketio.emit('dashboard_chart_data', ticks)

    def on_order_update(ws, order):
        logger.info(f"Order Update WS Message: {order}")
        socketio.emit('kite_order_update', order)

    def on_connect(ws, response):
        logger.info("Kite WS Connection Opened.")
        if ws:
            ws.subscribe(symbols_to_subscribe_tokens)
            ws.set_mode(ws.MODE_FULL, symbols_to_subscribe_tokens)
        socketio.emit('dashboard_chart_data', {'status': f'Subscribed to tokens {list(symbols_to_subscribe_tokens)}'})
        socketio.emit('kite_order_update', {'status': 'Connected for order updates'})

    def on_close(ws, code, reason):
        logger.info(f"Kite WS Closed: {code} - {reason}")
        socketio.emit('dashboard_chart_data', {'status': 'WebSocket closed', 'reason': reason})
        socketio.emit('kite_order_update', {'status': 'Order Update WebSocket closed', 'reason': reason})

    def on_error(ws, code, reason):
        logger.error(f"Kite WS Error: {code} - {reason}")
        socketio.emit('dashboard_chart_data', {'error': f'WebSocket error: {reason}'})
        socketio.emit('kite_order_update', {'error': f'Order Update WebSocket error: {reason}'})

    kws_ticker.on_ticks = on_ticks
    kws_ticker.on_connect = on_connect
    kws_ticker.on_close = on_close
    kws_ticker.on_error = on_error
    kws_ticker.on_order_update = on_order_update

    if kws_ticker:
        kws_ticker.connect(threaded=True, disable_ssl_verification=False)
    else:
        logger.error("kws_ticker is None, cannot connect.")
        return

    try:
        while kws_ticker and kws_ticker.is_connected():
            time.sleep(1)
    except Exception as e:
        logger.error(f"Exception in kite_websocket_task monitoring loop: {e}")
    finally:
        logger.info("Kite WebSocket task finished or kws_ticker disconnected.")
        if kws_ticker and kws_ticker.is_connected():
            kws_ticker.stop()

@app.route('/search-nse-symbols', methods=['GET'])
def search_nse_symbols():
    kite = get_kite_instance()
    if not kite:
        return jsonify({"error": "User not authenticated"}), 401

    query = request.args.get('query', '')
    if not query or len(query) < 2:
        return jsonify([])

    global instrument_map
    # Optimization: Fetch and cache all NSE EQ instruments once if not already done
    if not instrument_map:
        try:
            all_nse_instruments = kite.instruments("NSE")
            # Filter for NSE Equities and cache them
            instrument_map = {
                inst['tradingsymbol']: inst
                for inst in all_nse_instruments
                if inst.get('instrument_type') == 'EQ' and inst.get('exchange') == 'NSE'
            }
            logger.info(f"Fetched and cached {len(instrument_map)} NSE EQ instruments.")
        except Exception as e:
            logger.error(f"Error fetching or caching NSE instruments: {e}")
            return jsonify({"error": "Failed to fetch instruments"}), 500

    try:
        # Search within the cached NSE EQ instruments
        search_results_from_cache = [
            inst for symbol, inst in instrument_map.items()
            if query.lower() in symbol.lower() or query.lower() in inst.get('name', '').lower()
        ]

        processed_results = []
        for item in search_results_from_cache:
            processed_results.append({
                "symbol": item['tradingsymbol'],
                "description": item.get('name', item['tradingsymbol']),
                "instrument_token": item['instrument_token'],
                "exchange": item['exchange'],
                "instrument_type": item.get('instrument_type')  # Optional: send to frontend if needed
            })

        logger.info(f"Processed NSE EQ symbol search results for '{query}': {len(processed_results)} items")
        return jsonify(processed_results[:50])  # Return top 50 matches

    except Exception as e:
        logger.error(f"Error in search_nse_symbols: {str(e)}")
        return jsonify({"error": "An internal error occurred during symbol search"}), 500

@socketio.on('connect_dashboard_ws')
def handle_connect_dashboard_ws(data):
    global dashboard_ws_thread, kws_ticker, subscribed_tokens, instrument_map
    access_token = get_access_token()
    public_token = session.get('kite_public_token')

    if not access_token or not api_key:
        emit('dashboard_chart_data', {'error': 'User not authenticated or API key missing'})
        return

    instrument_tokens_to_subscribe = data.get('instrument_tokens')

    if not instrument_tokens_to_subscribe:
        emit('dashboard_chart_data', {'error': 'No instrument tokens provided for subscription.'})
        return

    logger.info(f"Request to connect/update Kite WebSocket for tokens: {instrument_tokens_to_subscribe}")

    new_tokens = set(instrument_tokens_to_subscribe)

    if kws_ticker and kws_ticker.is_connected():
        logger.info("Kite WebSocket is already running.")

        to_subscribe = list(new_tokens - subscribed_tokens)
        to_unsubscribe = list(subscribed_tokens - new_tokens)

        if to_unsubscribe:
            if kws_ticker:
                kws_ticker.unsubscribe(to_unsubscribe)
            logger.info(f"Unsubscribed from tokens: {to_unsubscribe}")
            subscribed_tokens.difference_update(to_unsubscribe)
        if to_subscribe:
            if kws_ticker:
                kws_ticker.subscribe(to_subscribe)
                kws_ticker.set_mode(kws_ticker.MODE_FULL, to_subscribe)
            logger.info(f"Subscribed to new tokens: {to_subscribe}")
            subscribed_tokens.update(to_subscribe)

        emit('dashboard_chart_data', {'status': f'Subscription updated. Currently subscribed to {list(subscribed_tokens)}'})
        return

    if dashboard_ws_thread and dashboard_ws_thread.is_alive():
        logger.info("Dashboard WebSocket thread is alive but kws_ticker might not be connected. Stopping old thread.")
        if kws_ticker:
            kws_ticker.stop()
        if dashboard_ws_thread:
            dashboard_ws_thread.join(timeout=5)

    logger.info("Starting new Kite WebSocket thread.")
    subscribed_tokens = new_tokens
    dashboard_ws_thread = threading.Thread(
        target=kite_websocket_task,
        args=(access_token, public_token, list(subscribed_tokens)),
        daemon=True
    )
    dashboard_ws_thread.start()
    emit('dashboard_chart_data', {'status': f'Kite WebSocket connection process started for tokens {list(subscribed_tokens)}'})

@socketio.on('disconnect_dashboard_ws')
def handle_disconnect_dashboard_ws():
    global dashboard_ws_thread, kws_ticker, subscribed_tokens
    logger.info("Request to disconnect Kite WebSocket.")
    if kws_ticker:
        kws_ticker.stop()
        kws_ticker = None
    if dashboard_ws_thread and dashboard_ws_thread.is_alive():
        logger.info("Kite WebSocket thread was running. It should stop now.")
    dashboard_ws_thread = None
    subscribed_tokens = set()
    emit('dashboard_chart_data', {'status': 'Kite WebSocket disconnected'})

@socketio.on('connect_order_updates')
def handle_connect_order_updates():
    global kws_ticker
    if not get_access_token():
        emit('kite_order_update', {'error': 'User not authenticated for order updates'})
        return

    if kws_ticker and kws_ticker.is_connected():
        logger.info("Order Update WS (KiteTicker) is already connected.")
        emit('kite_order_update', {'status': 'Order Update WebSocket (KiteTicker) already active and listening for order updates.'})
    else:
        logger.info("Order Update WS (KiteTicker) is not connected. Please connect the main dashboard WebSocket first.")
        emit('kite_order_update', {'error': 'Main WebSocket not connected. Order updates are handled by it.'})

@socketio.on('disconnect_order_updates')
def handle_disconnect_order_updates():
    logger.info("Request to disconnect Order Update WebSocket (KiteTicker). This typically means disconnecting the main WebSocket.")
    emit('kite_order_update', {'status': 'Order Update WebSocket (KiteTicker) disconnected (implies main WebSocket disconnected).'})

@app.route('/')
def index():
    if not get_access_token():
        return redirect('/login')
    return redirect('/dashboard')

@app.route('/login')
def login():
    session.clear()
    if not api_key:
        logger.error("Missing KITE_API_KEY environment variable.")
        return render_template('layout.html', error="API Key not configured. Please check server logs.")

    try:
        # Create a new KiteConnect instance for login
        kite_login = KiteConnect(api_key=api_key)
        login_url = kite_login.login_url()
        logger.info(f"Generated Kite login URL: {login_url}")
        return redirect(login_url)
    except Exception as e:
        logger.error(f"Error generating login URL: {str(e)}")
        return render_template('layout.html', error="Failed to generate login URL.")

@app.route('/callback')
def callback():
    """
    Route that handles the callback from Kite Connect after user authorization
    """
    try:
        request_token = request.args.get('request_token')
        if not request_token:
            logger.error("No request token found in callback")
            return render_template('layout.html', error="No request token received from Kite.")

        # Create a new KiteConnect instance for generating session
        kite_session = KiteConnect(api_key=api_key)

        # Generate user session and store it
        data = kite_session.generate_session(request_token, api_secret=api_secret)

        # Store tokens in session
        session['kite_access_token'] = data['access_token']
        session['kite_public_token'] = data.get('public_token')

        # Set the access token in kite instance
        kite_session.set_access_token(data['access_token'])

        # Fetch and store user profile
        try:
            profile = kite_session.profile()
            session['user_profile'] = profile
            logger.info("User profile fetched and stored in session")
        except Exception as e_profile:
            logger.error(f"Error fetching profile: {str(e_profile)}")
            session.pop('user_profile', None)

        return redirect('/dashboard')
    except Exception as e:
        logger.error(f"Error in callback: {str(e)}")
        if hasattr(e, 'response') and getattr(e, 'response') is not None:
            logger.error(f"Kite API error response: {e.response.text}")
        return render_template('layout.html', error=f"Error during authentication: {str(e)}")

@app.route('/dashboard')
@require_login
def dashboard():
    """
    Protected dashboard route
    """
    try:
        kite = get_kite_instance()
        if not kite:
            logger.error("Failed to get Kite instance in dashboard route")
            return redirect('/login')

        # Get profile from session or fetch it if not available
        profile = session.get('user_profile')
        if not profile:
            try:
                profile = kite.profile()
                session['user_profile'] = profile
                logger.info("Fetched fresh profile data for dashboard")
            except Exception as e:
                logger.error(f"Error fetching profile for dashboard: {str(e)}")

        return render_template('dashboard.html', profile=profile)
    except Exception as e:
        logger.error(f"Error accessing dashboard: {str(e)}")
        session.clear()  # Clear invalid session
        return redirect('/login')

@app.route('/profile')
@require_login
def user_profile():
    profile_data = session.get('user_profile')
    if not profile_data:
        # Attempt to fetch profile if not in session
        kite = get_kite_instance()
        if kite:
            try:
                profile_data = kite.profile()
                session['user_profile'] = profile_data
            except Exception as e:
                logger.error(f"Error fetching profile for /profile route: {str(e)}")
                # Optionally, redirect to login or show an error page
                return render_template('layout.html', error="Could not load profile. Please try logging in again.")
        else:
            return redirect('/login') # Should not happen if @require_login works

    return render_template('profile.html', profile=profile_data)

@app.route('/logout')
def logout():
    session.clear()
    logger.info("User logged out, session cleared.")
    return redirect('/login')

