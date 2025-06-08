from flask import Flask, render_template, request, redirect, session, jsonify
from kiteconnect import KiteConnect, KiteTicker
from dotenv import load_dotenv
import os
import logging
from flask_socketio import SocketIO, emit
import threading
import time
from functools import wraps
import json

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

# Global instrument caches and watchlist directory setup
instrument_map_by_symbol = {}
instrument_map_by_token = {}
WATCHLIST_DIR = os.path.join(os.getcwd(), "user_watchlists")
os.makedirs(WATCHLIST_DIR, exist_ok=True)

def get_watchlist_filepath(user_id):
    return os.path.join(WATCHLIST_DIR, f"{user_id}_watchlist.json")

# Global WebSocket client and thread for the dashboard chart
kws_ticker = None
dashboard_ws_thread = None
subscribed_tokens = set()

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

def ensure_instruments_cached(kite):
    global instrument_map_by_symbol, instrument_map_by_token
    if not instrument_map_by_symbol:
        try:
            logger.info("Instrument cache empty, fetching from Kite...")
            all_nse_instruments = kite.instruments("NSE")
            temp_map_by_symbol = {}
            temp_map_by_token = {}
            for inst in all_nse_instruments:
                if inst.get('instrument_type') == 'EQ' and \
                   inst.get('exchange') == 'NSE' and \
                   inst.get('tradingsymbol') and \
                   inst.get('instrument_token') is not None and \
                   inst.get('name'):
                    temp_map_by_symbol[inst['tradingsymbol']] = inst
                    try:
                        token_key = int(inst['instrument_token'])
                        temp_map_by_token[token_key] = inst
                    except ValueError:
                        logger.warning(f"Could not convert instrument token {inst['instrument_token']} to int for {inst['tradingsymbol']}")
            instrument_map_by_symbol = temp_map_by_symbol
            instrument_map_by_token = temp_map_by_token
            logger.info(f"Fetched and cached {len(instrument_map_by_symbol)} NSE EQ instruments.")
        except Exception as e:
            logger.error(f"Error fetching or caching NSE instruments: {e}")
            raise

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
@require_login
def search_nse_symbols():
    kite = get_kite_instance()
    if not kite:
        return jsonify({"error": "User not authenticated or Kite instance unavailable"}), 401

    try:
        ensure_instruments_cached(kite)
    except Exception as e:
        logger.error(f"Failed to ensure instruments are cached for search: {e}")
        return jsonify({"error": "Failed to initialize instrument data"}), 500

    query = request.args.get('query', '').lower()
    if not query or len(query) < 2:
        return jsonify([])

    try:
        search_results_from_cache = [
            inst for symbol, inst in instrument_map_by_symbol.items()
            if query in symbol.lower() or query in inst.get('name', '').lower()
        ]
        processed_results = [
            {
                "symbol": item['tradingsymbol'],
                "description": item.get('name', item['tradingsymbol']),
                "instrument_token": item['instrument_token'],
                "exchange": item['exchange'],
                "instrument_type": item.get('instrument_type')
            }
            for item in search_results_from_cache
        ]
        return jsonify(processed_results[:50])
    except Exception as e:
        logger.error(f"Error in search_nse_symbols: {str(e)}")
        return jsonify({"error": "An internal error occurred during symbol search"}), 500

@app.route('/api/watchlist/load', methods=['GET'])
@require_login
def load_watchlist_route():
    user_id = session.get('user_id')
    if not user_id:
        logger.warning("Attempt to load watchlist without user_id in session.")
        return jsonify({"error": "User ID not found in session"}), 401

    kite = get_kite_instance()
    if not kite:
         logger.error(f"Kite instance not available for user {user_id} during watchlist load.")
         return jsonify({"error": "Kite instance not available"}), 500
    try:
        ensure_instruments_cached(kite)
    except Exception as e:
        logger.error(f"Failed to ensure instruments are cached for watchlist load (user {user_id}): {e}")
        return jsonify({"error": "Failed to initialize instrument data for watchlist"}), 500

    filepath = get_watchlist_filepath(user_id)
    saved_instruments_details = []
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                instrument_tokens = json.load(f)
            if not isinstance(instrument_tokens, list):
                logger.warning(f"Watchlist file for user {user_id} does not contain a list. File: {filepath}. Treating as empty.")
                instrument_tokens = []

            for token_from_file in instrument_tokens:
                try:
                    token_key = int(token_from_file)
                    if token_key in instrument_map_by_token:
                        saved_instruments_details.append(instrument_map_by_token[token_key])
                    else:
                        logger.warning(f"Token {token_key} from user {user_id}'s watchlist not found in instrument cache.")
                except ValueError:
                     logger.warning(f"Invalid token format {token_from_file} in watchlist for user {user_id}. Skipping.")
        except json.JSONDecodeError:
            logger.error(f"Error decoding JSON from watchlist file: {filepath}. Creating empty watchlist.")
            if os.path.exists(filepath):
                try:
                    os.rename(filepath, filepath + ".corrupted_" + str(int(time.time())))
                    logger.info(f"Renamed corrupted watchlist file for user {user_id} to {filepath}.corrupted_{str(int(time.time()))}")
                except OSError as e_rename:
                    logger.error(f"Could not rename corrupted watchlist file {filepath}: {e_rename}")
            saved_instruments_details = []
        except Exception as e:
            logger.error(f"Error loading watchlist for user {user_id}: {e}")
            return jsonify({"error": "Could not load watchlist"}), 500
    else:
        logger.info(f"No watchlist file found for user {user_id} at {filepath}. Returning empty watchlist.")

    return jsonify({"watchlist": saved_instruments_details})

@app.route('/api/watchlist/save', methods=['POST'])
@require_login
def save_watchlist_route():
    user_id = session.get('user_id')
    if not user_id:
        logger.warning("Attempt to save watchlist without user_id in session.")
        return jsonify({"error": "User ID not found in session"}), 401

    data = request.get_json()
    if not data or 'instrument_tokens' not in data or not isinstance(data['instrument_tokens'], list):
        return jsonify({"error": "Invalid payload. Expected {'instrument_tokens': [list_of_tokens]}"}), 400

    instrument_tokens_to_save = []
    for t in data['instrument_tokens']:
        try:
            instrument_tokens_to_save.append(int(t))
        except ValueError:
            logger.warning(f"Invalid token format found in save request for user {user_id}: {t}. Skipping this token.")

    filepath = get_watchlist_filepath(user_id)
    try:
        with open(filepath, 'w') as f:
            json.dump(instrument_tokens_to_save, f)
        logger.info(f"Watchlist saved for user {user_id} with {len(instrument_tokens_to_save)} tokens.")
        return jsonify({"status": "success", "count": len(instrument_tokens_to_save)})
    except Exception as e:
        logger.error(f"Error saving watchlist for user {user_id}: {e}")
        return jsonify({"status": "error", "message": "Could not save watchlist"}), 500

@socketio.on('connect_dashboard_ws')
def handle_connect_dashboard_ws(data):
    global dashboard_ws_thread, kws_ticker, subscribed_tokens
    access_token = get_access_token()

    if not access_token or not api_key:
        logger.warning("Dashboard WS connection attempt without access token or API key.")
        emit('dashboard_chart_data', {'error': 'User not authenticated or API key missing'})
        return

    new_desired_tokens = set(data.get('instrument_tokens', []))
    tokens_explicitly_to_unsubscribe = set(data.get('instrument_tokens_to_unsubscribe', []))

    logger.info(f"Dashboard WS request: Desired tokens: {new_desired_tokens}, Explicit Unsubscribe: {tokens_explicitly_to_unsubscribe}")

    current_live_subscriptions = set(subscribed_tokens)
    final_tokens_for_kws = set(current_live_subscriptions)

    if tokens_explicitly_to_unsubscribe:
        final_tokens_for_kws.difference_update(tokens_explicitly_to_unsubscribe)

    if new_desired_tokens:
        final_tokens_for_kws = new_desired_tokens
    elif not tokens_explicitly_to_unsubscribe and not new_desired_tokens and 'instrument_tokens' in data:
        final_tokens_for_kws.clear()

    tokens_to_add_to_kws = list(final_tokens_for_kws - current_live_subscriptions)
    tokens_to_remove_from_kws = list(current_live_subscriptions - final_tokens_for_kws)

    if tokens_to_remove_from_kws and kws_ticker and kws_ticker.is_connected():
        try:
            kws_ticker.unsubscribe(tokens_to_remove_from_kws)
            logger.info(f"KWS: Unsubscribed from {tokens_to_remove_from_kws}")
            for token in tokens_to_remove_from_kws:
                subscribed_tokens.discard(token)
        except Exception as e:
            logger.error(f"KWS: Error unsubscribing: {e}")
    elif tokens_to_remove_from_kws:
        for token in tokens_to_remove_from_kws:
            subscribed_tokens.discard(token)
        logger.info(f"KWS not connected. Marked {tokens_to_remove_from_kws} for removal from internal state.")

    subscribed_tokens = set(final_tokens_for_kws)
    logger.info(f"Internal subscribed_tokens updated to: {subscribed_tokens}")

    if not subscribed_tokens:
        logger.info("No tokens to subscribe to. Stopping KWS if running.")
        if kws_ticker and kws_ticker.is_connected():
            kws_ticker.stop()
        if dashboard_ws_thread and dashboard_ws_thread.is_alive():
            dashboard_ws_thread.join(timeout=1)
        kws_ticker = None
        dashboard_ws_thread = None
        emit('dashboard_chart_data', {'status': 'Watchlist empty, WebSocket stopped.'})
        return

    if not kws_ticker or not kws_ticker.is_connected():
        logger.info("(Re)starting KWS ticker thread.")
        if kws_ticker:
            kws_ticker.stop()
        if dashboard_ws_thread and dashboard_ws_thread.is_alive():
            dashboard_ws_thread.join(timeout=1)

        kws_ticker = None
        dashboard_ws_thread = threading.Thread(
            target=kite_websocket_task,
            args=(access_token, session.get('kite_public_token'), list(subscribed_tokens)),
            daemon=True
        )
        dashboard_ws_thread.start()
    elif tokens_to_add_to_kws:
        try:
            logger.info(f"KWS connected. Subscribing to additional tokens: {tokens_to_add_to_kws}")
            kws_ticker.subscribe(tokens_to_add_to_kws)
            kws_ticker.set_mode(kws_ticker.MODE_FULL, tokens_to_add_to_kws)
        except Exception as e:
            logger.error(f"Error subscribing to additional KWS tokens: {e}")
    else:
        logger.info("KWS connected. No new tokens to add, or only unsubscriptions occurred.")
        emit('dashboard_chart_data', {'status': f'Subscriptions managed. Currently watching {list(subscribed_tokens)}'})

@socketio.on('disconnect_dashboard_ws')
def handle_disconnect_dashboard_ws():
    global dashboard_ws_thread, kws_ticker, subscribed_tokens
    logger.info("Request to disconnect Kite WebSocket from client.")
    if kws_ticker and kws_ticker.is_connected():
        kws_ticker.stop()
    kws_ticker = None
    if dashboard_ws_thread and dashboard_ws_thread.is_alive():
        dashboard_ws_thread.join(timeout=2)
    dashboard_ws_thread = None
    subscribed_tokens = set()
    emit('dashboard_chart_data', {'status': 'Kite WebSocket disconnected by client request.'})

@socketio.on('connect_order_updates')
def handle_connect_order_updates():
    global kws_ticker
    if not get_access_token():
        emit('kite_order_update', {'error': 'User not authenticated for order updates'})
        return
    if kws_ticker and kws_ticker.is_connected():
        logger.info("Order Update WS (KiteTicker) is already connected via main dashboard WS.")
        emit('kite_order_update', {'status': 'Order updates are active via main dashboard WebSocket.'})
    else:
        logger.info("Order Update WS (KiteTicker) is not connected. Please connect the main dashboard WebSocket first.")
        emit('kite_order_update', {'error': 'Main WebSocket not connected. Order updates are handled by it.'})

@socketio.on('disconnect_order_updates')
def handle_disconnect_order_updates():
    logger.info("Request to disconnect Order Update WebSocket (handled by main dashboard WS disconnect).")
    emit('kite_order_update', {'status': 'Order Update WebSocket disconnected (implies main WebSocket disconnected).'})

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
        kite_login_instance = KiteConnect(api_key=api_key)
        login_url = kite_login_instance.login_url()
        logger.info(f"Generated Kite login URL: {login_url}")
        return redirect(login_url)
    except Exception as e:
        logger.error(f"Error generating login URL: {str(e)}")
        return render_template('layout.html', error="Failed to generate login URL.")

@app.route('/callback')
def callback():
    request_token = request.args.get('request_token')
    if not request_token:
        logger.error("No request token found in callback")
        return render_template('layout.html', error="No request token received from Kite.")
    try:
        kite_session_instance = KiteConnect(api_key=api_key)
        data = kite_session_instance.generate_session(request_token, api_secret=api_secret)

        session['kite_access_token'] = data['access_token']
        session['kite_public_token'] = data.get('public_token')
        session['user_id'] = data.get('user_id') # Crucial for watchlist saving

        logger.info(f"Kite session generated for user_id: {data.get('user_id')}. Access token stored.")

        # Pre-fetch profile and store in session
        try:
            kite_session_instance.set_access_token(data['access_token'])
            profile = kite_session_instance.profile()
            session['user_profile'] = profile
            logger.info(f"User profile fetched and stored in session for user {data.get('user_id')}")
        except Exception as e_profile:
            logger.error(f"Error fetching profile immediately after login: {str(e_profile)}")
            # Continue without profile in session for now, can be fetched later

        return redirect('/dashboard')
    except Exception as e:
        logger.error(f"Error in callback during session generation: {str(e)}")
        if hasattr(e, 'response') and getattr(e, 'response') is not None:
            logger.error(f"Kite API error response: {e.response.text}")
        return render_template('layout.html', error=f"Error during authentication: {str(e)}")

@app.route('/dashboard')
@require_login
def dashboard():
    profile = session.get('user_profile')
    if not profile:
        kite = get_kite_instance()
        if kite:
            try:
                profile = kite.profile()
                session['user_profile'] = profile
            except Exception as e:
                logger.error(f"Error fetching profile for dashboard: {str(e)}")
        else:
            logger.warning("Could not get Kite instance for dashboard profile fetch.")
    return render_template('dashboard.html', profile=profile)

@app.route('/profile')
@require_login
def user_profile():
    profile_data = session.get('user_profile')
    if not profile_data:
        kite = get_kite_instance()
        if kite:
            try:
                profile_data = kite.profile()
                session['user_profile'] = profile_data
            except Exception as e:
                logger.error(f"Error fetching profile for /profile route: {str(e)}")
                return render_template('layout.html', error="Could not load profile. Please try logging in again.")
        else:
            return redirect('/login')

    return render_template('profile.html', profile=profile_data)

@app.route('/logout')
def logout():
    user_id = session.get('user_id', 'UnknownUser')
    logger.info(f"User {user_id} logging out. Clearing session.")
    session.clear()
    # Instead of redirect, render the login page directly
    return render_template('login.html', error=None)

@app.route('/market_data')
@require_login
def market_data():
    symbol = request.args.get('symbol')
    if not symbol:
        return jsonify({'code': 400, 'message': 'Missing symbol parameter'}), 400
    kite = get_kite_instance()
    if not kite:
        return jsonify({'code': 401, 'message': 'Not authenticated'}), 401
    try:
        ensure_instruments_cached(kite)
        instrument = instrument_map_by_symbol.get(symbol)
        if not instrument:
            # Try to match by tradingsymbol upper/lower
            instrument = next((v for k, v in instrument_map_by_symbol.items() if k.lower() == symbol.lower()), None)
        if not instrument:
            return jsonify({'code': 404, 'message': f'Symbol {symbol} not found'}), 404
        # Fetch quote from Kite
        quote = kite.ltp(f"NSE:{instrument['tradingsymbol']}")
        ltp_data = quote.get(f"NSE:{instrument['tradingsymbol']}", {})
        # Compose response
        return jsonify({
            'code': 200,
            'data': {
                'symbol': instrument['tradingsymbol'],
                'ltp': ltp_data.get('last_price'),
                'open': ltp_data.get('ohlc', {}).get('open'),
                'high': ltp_data.get('ohlc', {}).get('high'),
                'low': ltp_data.get('ohlc', {}).get('low'),
                'close': ltp_data.get('ohlc', {}).get('close'),
                'change': (ltp_data.get('last_price', 0) - ltp_data.get('ohlc', {}).get('close', 0)) if ltp_data.get('last_price') and ltp_data.get('ohlc', {}).get('close') else 0,
                'percentage_change': ((ltp_data.get('last_price', 0) - ltp_data.get('ohlc', {}).get('close', 0)) / ltp_data.get('ohlc', {}).get('close', 1) * 100) if ltp_data.get('last_price') and ltp_data.get('ohlc', {}).get('close') else 0
            }
        })
    except Exception as e:
        logger.error(f"Error fetching market data for {symbol}: {e}")
        return jsonify({'code': 500, 'message': 'Internal error fetching market data'})

if __name__ == '__main__':
    logger.info("Starting PyAlgoKite application...")
    socketio.run(app, host='0.0.0.0', port=6010, debug=True, use_reloader=False)
