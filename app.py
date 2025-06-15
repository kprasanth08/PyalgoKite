from flask import Flask, render_template, request, redirect, session, jsonify, make_response
from kiteconnect import KiteConnect, KiteTicker
from dotenv import load_dotenv
import os
import logging
from flask_socketio import SocketIO, emit
import threading
import time
from functools import wraps
import json
import upstox_service  # Import the new Upstox service
import asyncio  # For running async websocket code
import requests
from datetime import datetime, timedelta

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

# Global variables for Upstox WebSocket
upstox_ws_thread = None
upstox_subscribed_instrument_keys = set()  # Stores keys like "NSE_EQ|INE002A01018"
upstox_ws_shutdown_event = None # Will be a threading.Event

# Global variable to store watchlist LTPC updates
watchlist_ltpc_data = {}

def get_watchlist_filepath(user_id=None):
    # Use a shared watchlist file instead of user-specific ones
    return os.path.join(WATCHLIST_DIR, "shared_watchlist.json")

# Middleware to check if the user is logged in
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated_function

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
    Checks for both Kite and Upstox authentication
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Check if user is logged in with either Kite or Upstox
        kite_authenticated = get_access_token() is not None
        upstox_authenticated = session.get('upstox_authenticated', False)

        if not (kite_authenticated or upstox_authenticated):
            # If not authenticated with either service, redirect to login page
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

def process_upstox_feed(feed_response, emit_callback):
    """
    Processes the protobuf FeedResponse and extracts relevant market data.
    Emits a structured tick to the client via the provided callback.
    """
    try:
        for instrument_key, feed_data in feed_response.feeds.items():
            tick = {
                "instrument_key": instrument_key,
                "timestamp": int(time.time() * 1000)
            }

            if feed_data.ff.marketFF.ltpc:
                ltpc = feed_data.ff.marketFF.ltpc
                tick["last_price"] = ltpc.ltp
                tick["change"] = ltpc.ch if ltpc.ch is not None else (ltpc.ltp - ltpc.cp if ltpc.ltp and ltpc.cp else 0)
                tick["percentage_change"] = ltpc.chp
                tick["last_traded_time"] = ltpc.ltt
                if ltpc.ltt:
                    tick["timestamp"] = ltpc.ltt * 1000

            if feed_data.ff.marketFF.ohlc:
                ohlc = feed_data.ff.marketFF.ohlc
                tick["ohlc"] = {
                    "open": ohlc.open,
                    "high": ohlc.high,
                    "low": ohlc.low,
                    "close": ohlc.close
                }

            emit_callback('upstox_market_tick', tick)

    except Exception as e:
        logger.error(f"Error processing Upstox feed: {e}", exc_info=True)

@socketio.on('subscribe_upstox_market_data')
@require_login
def handle_subscribe_upstox_market_data(data):
    global upstox_ws_thread, upstox_subscribed_instrument_keys, upstox_ws_shutdown_event

    instrument_keys_to_subscribe = data.get('instrument_keys', [])
    if not isinstance(instrument_keys_to_subscribe, list): # Added check for empty list as well
        logger.warning("Invalid or empty instrument_keys for Upstox subscription.")
        emit('upstox_market_data_error', {'error': 'Invalid or empty instrument keys provided.'})
        return

    logger.info(f"Request to subscribe/update Upstox market data for: {instrument_keys_to_subscribe}")

    # --- Shutdown existing thread if running ---
    if upstox_ws_thread and upstox_ws_thread.is_alive():
        logger.info("Attempting to stop existing Upstox WebSocket thread.")
        if upstox_ws_shutdown_event:
            upstox_ws_shutdown_event.set()  # Signal the async function in the thread to stop

        upstox_ws_thread.join(timeout=5.0)  # Wait for the thread to finish
        if upstox_ws_thread.is_alive():
            logger.warning("Upstox WebSocket thread did not stop in time after join. It might be stuck.")
        else:
            logger.info("Existing Upstox WebSocket thread has been joined.")
        upstox_ws_thread = None # Clear the old thread reference
    upstox_ws_shutdown_event = None # Clear or will be reset

    # Update current subscriptions to the new set
    new_subscription_set = set(instrument_keys_to_subscribe)
    upstox_subscribed_instrument_keys = new_subscription_set

    # If no instruments to subscribe to after update, ensure everything is stopped and return
    if not upstox_subscribed_instrument_keys:
        logger.info("No instruments to subscribe to for Upstox WebSocket. Connection will remain closed.")
        # upstox_ws_thread and upstox_ws_shutdown_event are already None or will be.
        emit('upstox_market_data_status', {'status': 'No instruments for Upstox WebSocket subscription. Connection closed.'})
        return

    # --- Proceed with new connection/subscription ---
    upstox_api_client = upstox_service.get_configuration_api_client()
    if not upstox_api_client:
        logger.error("Failed to get Upstox ApiClient for WebSocket.")
        emit('upstox_market_data_error', {'error': 'Upstox authentication failed or ApiClient not available.'})
        return

    feed_url = upstox_service.get_market_data_feed_authorize_url(upstox_api_client)
    logger.debug(f"Feed URL: {feed_url}")
    if not feed_url:
        logger.error("Failed to get Upstox market data feed URL.")
        emit('upstox_market_data_error', {'error': 'Failed to get market data feed URL.'})
        return

    # Callback for processing messages from the WebSocket service
    def on_upstox_message_socketio(feed_response):
        process_upstox_feed(feed_response, socketio.emit)
        on_upstox_market_data(feed_response) # For LTPC updates

    logger.info(f"Starting new Upstox WebSocket thread for instruments: {list(upstox_subscribed_instrument_keys)}")

    # Create a new threading.Event for the new thread
    upstox_ws_shutdown_event = threading.Event()

    def run_websocket_loop_in_thread():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(upstox_service.connect_and_stream_market_data(
                feed_url,
                list(upstox_subscribed_instrument_keys),
                on_upstox_message_socketio,
                upstox_ws_shutdown_event  # Pass the threading.Event
            ))
        except Exception as e_thread:
            logger.error(f"Exception in Upstox WebSocket thread's event loop: {e_thread}", exc_info=True)
        finally:
            loop.close()
            logger.info("Upstox WebSocket thread event loop and asyncio loop closed.")

    upstox_ws_thread = threading.Thread(target=run_websocket_loop_in_thread, daemon=True)
    upstox_ws_thread.start()

    emit('upstox_market_data_status', {
        'status': f'Subscribing to {list(upstox_subscribed_instrument_keys)} via Upstox WebSocket.'
    })

@socketio.on('unsubscribe_upstox_market_data')
@require_login
def handle_unsubscribe_upstox_market_data(data):
    global upstox_subscribed_instrument_keys # Other globals managed by handle_subscribe_upstox_market_data

    instrument_keys_to_unsubscribe = data.get('instrument_keys', [])
    if not isinstance(instrument_keys_to_unsubscribe, list):
        logger.warning("Invalid instrument_keys for Upstox unsubscription.")
        emit('upstox_market_data_error', {'error': 'Invalid instrument keys for unsubscription.'})
        return

    logger.info(f"Request to unsubscribe from Upstox market data for: {instrument_keys_to_unsubscribe}")

    made_change = False
    # Operate on a copy of the current subscriptions
    current_subscriptions_set = set(list(upstox_subscribed_instrument_keys))
    for key in instrument_keys_to_unsubscribe:
        if key in current_subscriptions_set:
            current_subscriptions_set.remove(key)
            made_change = True

    if made_change:
        logger.info(f"New Upstox subscription set after unsubscribe: {list(current_subscriptions_set)}")
        # Call the main subscription handler to reconnect with the new set (or close if empty)
        # This will handle stopping the old thread and starting a new one if needed.
        handle_subscribe_upstox_market_data({'instrument_keys': list(current_subscriptions_set)})
    else:
        logger.info("No changes to Upstox subscriptions from unsubscribe request.")
        # Emit current status even if no change, for client feedback
        emit('upstox_market_data_status', {
            'status': f'Current Upstox subscriptions (no change): {list(upstox_subscribed_instrument_keys)}'
        })

@app.route('/')
def index():
    # Check authentication status for both services
    kite_authenticated = get_access_token() is not None
    upstox_authenticated = session.get('upstox_authenticated', False)

    # Get profile information to display on the homepage
    kite_profile = session.get('user_profile')
    upstox_profile = session.get('upstox_profile')

    # Check if the Upstox token is expired and remove if needed
    if upstox_authenticated:
        token_expiry = session.get('upstox_token_expiry')
        if token_expiry and datetime.fromisoformat(token_expiry) <= datetime.now():
            # Token is expired, mark as not authenticated
            session['upstox_authenticated'] = False
            upstox_authenticated = False
            logger.info("Upstox token expired, marked as not authenticated")
        else:
            # If authenticated but profile is missing, try to get it again
            if not upstox_profile and session.get('upstox_access_token'):
                try:
                    # Use the access token to fetch profile
                    headers = {
                        'Accept': 'application/json',
                        'Api-Version': '2.0',
                        'Authorization': f'Bearer {session["upstox_access_token"]}'
                    }
                    profile_url = "https://api.upstox.com/v2/user/profile"
                    profile_response = requests.get(profile_url, headers=headers)
                    profile_response.raise_for_status()

                    # Parse response according to Upstox API documentation
                    response_data = profile_response.json()
                    upstox_profile = response_data.get('data', {})

                    # Log profile data structure for debugging
                    logger.info(f"Retrieved Upstox profile data: {upstox_profile}")

                    session['upstox_profile'] = upstox_profile
                    logger.info("Successfully retrieved Upstox user profile")
                except Exception as e:
                    logger.error(f"Error fetching Upstox user profile: {e}")

    # Render the index template with authentication status
    return render_template(
        'index.html',
        kite_authenticated=kite_authenticated,
        upstox_authenticated=upstox_authenticated,
        kite_profile=kite_profile,
        upstox_profile=upstox_profile
    )

@app.route('/login')
def login():
    # Save Upstox authentication data if it exists
    upstox_authenticated = session.get('upstox_authenticated', False)
    upstox_access_token = session.get('upstox_access_token')
    upstox_profile = session.get('upstox_profile')
    upstox_token_expiry = session.get('upstox_token_expiry')

    # Clear session but keep Upstox data if authenticated
    session.clear()

    # Restore Upstox authentication data if it was present
    if upstox_authenticated:
        session['upstox_authenticated'] = upstox_authenticated
        session['upstox_access_token'] = upstox_access_token
        session['upstox_profile'] = upstox_profile
        session['upstox_token_expiry'] = upstox_token_expiry

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
        kite = get_kite_instance() # Original logic attempts to get Kite instance

        profile = session.get('user_profile')
        if not profile and get_access_token(): # If Kite authenticated but profile missing in session
            if kite: # Ensure kite object is available
                try:
                    profile = kite.profile()
                    session['user_profile'] = profile
                    logger.info("Fetched fresh profile data for dashboard")
                except Exception as e:
                    logger.error(f"Error fetching profile for dashboard: {str(e)}")

        # Pass relevant profiles to the template.
        # dashboard.html would ideally be able to use profile (Kite) and/or upstox_profile
        upstox_profile = session.get('upstox_profile')

        resp = make_response(render_template('dashboard.html', profile=profile, upstox_profile=upstox_profile))
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        resp.headers['Pragma'] = 'no-cache' # For HTTP/1.0 proxies
        resp.headers['Expires'] = '0' # For proxies
        return resp
    except Exception as e:
        logger.error(f"Error accessing dashboard: {str(e)}")
        session.clear()  # Clear invalid session
        return redirect('/login') # Changed from /login_selection

@app.route('/profile')
@require_login
def user_profile():
    kite_profile_data = session.get('user_profile')
    upstox_profile_data = session.get('upstox_profile')

    # Attempt to fetch Kite profile if Kite authenticated and profile not in session
    if not kite_profile_data and get_access_token(): # get_access_token() checks for kite_access_token
        kite = get_kite_instance()
        if kite:
            try:
                kite_profile_data = kite.profile()
                session['user_profile'] = kite_profile_data
            except Exception as e:
                logger.error(f"Error fetching Kite profile for /profile route: {str(e)}")
                # Profile fetch failed, kite_profile_data remains None or its old value.
                # The template should handle cases where profile data might be missing.
                pass

    resp = make_response(render_template('profile.html', profile=kite_profile_data, upstox_profile=upstox_profile_data))
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/logout')
def logout():
    session.clear()
    logger.info("User logged out, session cleared.")
    return redirect('/')  # Redirect to homepage instead of login selection page

# API Routes for Watchlist and Symbol Search

@app.route('/api/watchlist/load')
@require_login
def load_watchlist():
    """API endpoint to load a user's watchlist with full market quote data"""
    try:
        # Use user_id from session or a default if not available
        #user_id = session.get('user_profile', {}).get('user_id', 'default_user')

        watchlist_path = get_watchlist_filepath()
        watchlist_items = []
        instrument_keys = []

        if os.path.exists(watchlist_path):
            with open(watchlist_path, 'r') as f:
                watchlist_data = json.load(f)

            # First pass: Create basic watchlist items and collect instrument_keys
            for item in watchlist_data:
                # Handle both string format and object format in watchlist
                if isinstance(item, str):
                    tradingsymbol = item
                    # Get the proper instrument_key from the instruments cache instead of simple concatenation
                    instruments_cache = upstox_service.get_instruments_cache("NSE_EQ")
                    instrument_key = None

                    # Find the proper instrument_key for this symbol
                    if instruments_cache:
                        for instrument in instruments_cache:
                            if instrument.get('tradingsymbol') == tradingsymbol:
                                instrument_key = instrument.get('instrument_key')
                                break

                    # Only fall back to concatenation if lookup failed - we need some key for tracking
                    if not instrument_key:
                        # In a real-world scenario, we should use the proper key format from the API
                        # This is just a fallback for UI display purposes
                        logger.warning(f"Could not find instrument_key for {tradingsymbol} in instrument cache")
                        instrument_key = tradingsymbol  # Use tradingsymbol as a fallback key

                    enhanced_item = {"tradingsymbol": tradingsymbol, "instrument_key": instrument_key}
                else:
                    # Item is already an object
                    enhanced_item = item
                    tradingsymbol = item.get('tradingsymbol')
                    instrument_key = item.get('instrument_key')

                    # If no instrument_key is saved in the object, look up the correct one
                    if not instrument_key and tradingsymbol:
                        instruments_cache = upstox_service.get_instruments_cache("NSE_EQ")
                        if instruments_cache:
                            for instrument in instruments_cache:
                                if instrument.get('tradingsymbol') == tradingsymbol:
                                    instrument_key = instrument.get('instrument_key')
                                    enhanced_item['instrument_key'] = instrument_key
                                    break

                        # If still not found, use tradingsymbol as fallback key
                        if not instrument_key:
                            logger.warning(f"Could not find instrument_key for {tradingsymbol} in instrument cache")
                            instrument_key = tradingsymbol  # Use tradingsymbol as fallback key
                            enhanced_item['instrument_key'] = instrument_key

                # Add to watchlist items and collect instrument_key for bulk fetching
                watchlist_items.append(enhanced_item)
                if instrument_key:
                    instrument_keys.append(instrument_key)
            # Only fetch market data if we have instrument keys and user is authenticated with Upstox
            if instrument_keys and session.get('upstox_authenticated', False):
                try:
                    # Fetch full market quote data for all instruments at once
                    market_data = upstox_service.get_full_market_quote_v2(instrument_keys=instrument_keys)
                    if market_data:
                        # Second pass: Enhance watchlist items with market data
                        for item in watchlist_items:
                            instrument_key = item.get('instrument_key')
                            if instrument_key:
                                # Try to find the matching quote data either by direct key or by searching
                                quote = None

                                # Direct match
                                if instrument_key in market_data:
                                    quote = market_data[instrument_key]
                                else:
                                    # The instrument_key might be formatted differently in the response
                                    # Look for keys that contain the tradingsymbol
                                    tradingsymbol = item.get('tradingsymbol')
                                    if tradingsymbol:
                                        for key, value in market_data.items():
                                            # Check if the tradingsymbol is part of the key or in the instrument token
                                            if tradingsymbol in key or (
                                                    value.get('symbol') and tradingsymbol == value.get('symbol')):
                                                quote = value
                                                # Update the instrument_key to match what's in the market data
                                                item['instrument_key'] = key
                                                logger.info(f"Found market data for {tradingsymbol} using key {key}")
                                                break

                                if quote:
                                    # Add market data to each watchlist item
                                    item.update({
                                        "ltp": quote.get('last_price'),
                                        "last_price": quote.get('last_price'),
                                        "open": quote.get('ohlc', {}).get('open'),
                                        "high": quote.get('ohlc', {}).get('high'),
                                        "low": quote.get('ohlc', {}).get('low'),
                                        "close": quote.get('ohlc', {}).get('close'),
                                        "change": quote.get('net_change'),  # Updated from 'change' to 'net_change'
                                        "percentage_change": quote.get('change_percent', quote.get('net_change_percentage')),
                                        "volume": quote.get('volume'),
                                        "last_trade_time": quote.get('last_trade_time'),
                                        "bid": quote.get('depth', {}).get('buy', [{}])[0].get('price') if quote.get('depth', {}).get('buy') else None,
                                        "ask": quote.get('depth', {}).get('sell', [{}])[0].get('price') if quote.get('depth', {}).get('sell') else None,
                                        "total_buy_qty": quote.get('total_buy_quantity', quote.get('total_buy_qty')),
                                        "total_sell_qty": quote.get('total_sell_quantity', quote.get('total_sell_qty'))
                                    })
                                else:
                                    logger.warning(f"No market data found for {item.get('tradingsymbol')} with key {instrument_key}")
                        logger.info(f"Enhanced watchlist with full market quote data for {len(market_data)} instruments")
                    else:
                        logger.warning("No market data returned from get_full_market_quote_v2")
                except Exception as e:
                    logger.error(f"Error fetching full market quote data: {e}")
                    # Continue with basic watchlist items without market data
            else:
                logger.info(f"Skipping market data fetch: Found {len(instrument_keys)} instruments, Upstox auth: {session.get('upstox_authenticated', False)}")

            logger.info(f"Loaded watchlist , real-time updates will be provided by market feed")
            return jsonify({"success": True, "watchlist": watchlist_items})
        else:
            logger.info(f"No existing watchlist found for user ")
            return jsonify({"success": True, "watchlist": []})

    except Exception as e:
        logger.error(f"Error loading watchlist: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/watchlist/save', methods=['POST'])
@require_login
def save_watchlist():
    """API endpoint to save a user's watchlist"""
    try:
        watchlist_data = request.json.get('watchlist', [])

        # Use user_id from session or a default if not available
        #user_id = session.get('user_profile', {}).get('user_id', 'default_user')
        watchlist_path = get_watchlist_filepath()

        # Get the instrument cache only once for efficiency
        instruments_cache = upstox_service.get_instruments_cache("NSE_EQ")

        # Create a lookup dictionary for faster access to instruments by tradingsymbol
        symbol_to_instrument = {}
        if instruments_cache:
            for instrument in instruments_cache:
                tradingsymbol = instrument.get('tradingsymbol')
                if tradingsymbol:
                    symbol_to_instrument[tradingsymbol] = instrument
            logger.debug(f"Created symbol lookup from {len(symbol_to_instrument)} instruments")

        # Helper function to get instrument key from tradingsymbol
        def get_instrument_key(tradingsymbol):
            instrument = symbol_to_instrument.get(tradingsymbol)
            if instrument and 'instrument_key' in instrument:
                return instrument['instrument_key']
            logger.warning(f"Could not find instrument_key for {tradingsymbol} in instrument cache")
            return f"NSE_EQ|{tradingsymbol}"  # Fallback format

        # Helper function to process a watchlist item into standardized format
        def process_item(item):
            if isinstance(item, str):
                # Simple string format - convert to dictionary with tradingsymbol
                tradingsymbol = item
                instrument = symbol_to_instrument.get(tradingsymbol)

                processed_item = {"tradingsymbol": tradingsymbol}
                if instrument:
                    processed_item['name'] = instrument.get('name')
                    processed_item['instrument_key'] = instrument.get('instrument_key')

                return processed_item

            elif isinstance(item, dict):
                # Dictionary format - ensure it has name and instrument_key if possible
                processed_item = item.copy()  # Make a copy to avoid modifying the original
                tradingsymbol = item.get('tradingsymbol')

                if tradingsymbol and 'instrument_key' not in processed_item:
                    instrument = symbol_to_instrument.get(tradingsymbol)
                    if instrument:
                        if 'name' not in processed_item:
                            processed_item['name'] = instrument.get('name')
                        processed_item['instrument_key'] = instrument.get('instrument_key')


                # Remove any symbol/description fields to ensure we only use tradingsymbol/name
                processed_item.pop('symbol', None)
                processed_item.pop('description', None)

                return processed_item

            # If we get here, it's an unsupported format
            logger.warning(f"Skipping watchlist item with unexpected format: {item}")
            return None

        # Get the previous watchlist to detect new items
        previous_watchlist = []
        previous_instrument_keys = set()
        if os.path.exists(watchlist_path):
            try:
                with open(watchlist_path, 'r') as f:
                    previous_watchlist = json.load(f)

                # Extract instrument keys from previous watchlist
                for item in previous_watchlist:
                    if isinstance(item, str):
                        previous_instrument_keys.add(get_instrument_key(item))
                    elif isinstance(item, dict):
                        if 'instrument_key' in item:
                            previous_instrument_keys.add(item['instrument_key'])
                        elif 'tradingsymbol' in item:
                            previous_instrument_keys.add(get_instrument_key(item['tradingsymbol']))
            except Exception as e:
                logger.warning(f"Could not read previous watchlist: {e}")

        # Process watchlist data before saving
        processed_watchlist = []
        new_instrument_keys = []

        for item in watchlist_data:
            processed_item = process_item(item)
            if processed_item:
                processed_watchlist.append(processed_item)
                if 'instrument_key' in processed_item:
                    new_instrument_keys.append(processed_item['instrument_key'])

        # Save the processed watchlist
        with open(watchlist_path, 'w') as f:
            json.dump(processed_watchlist, f)

        logger.info(f"Processed and saved watchlist with {len(processed_watchlist)} items")

        # Find items that weren't in the previous watchlist
        new_added_items = [key for key in new_instrument_keys if key and key not in previous_instrument_keys]

        # If there are new items and the user is authenticated with Upstox,
        # fetch initial quote data and subscribe to market data feed
        if new_added_items and session.get('upstox_authenticated', False):
            try:
                # 1. Fetch initial quote data for the new items
                initial_data = upstox_service.get_full_market_quote_v2(instrument_keys=new_added_items)
                if initial_data:
                    logger.info(f"Fetched initial market data for {len(initial_data)} newly added watchlist items")

                    # Update the processed watchlist items with the market data
                    for item in processed_watchlist:
                        if 'instrument_key' in item and item['instrument_key'] in initial_data:
                            quote = initial_data[item['instrument_key']]
                            # Update the item with market data
                            item.update({
                                "ltp": quote.get('last_price'),
                                "last_price": quote.get('last_price'),
                                "open": quote.get('ohlc', {}).get('open'),
                                "high": quote.get('ohlc', {}).get('high'),
                                "low": quote.get('ohlc', {}).get('low'),
                                "close": quote.get('ohlc', {}).get('close'),
                                "change": quote.get('change', quote.get('net_change')),
                                "percentage_change": quote.get('change_percent', quote.get('net_change_percentage')),
                                "volume": quote.get('volume'),
                                "last_trade_time": quote.get('last_trade_time'),
                                "bid": quote.get('depth', {}).get('buy', [{}])[0].get('price') if quote.get('depth', {}).get('buy') else None,
                                "ask": quote.get('depth', {}).get('sell', [{}])[0].get('price') if quote.get('depth', {}).get('sell') else None,
                                "total_buy_qty": quote.get('total_buy_quantity', quote.get('total_buy_qty')),
                                "total_sell_qty": quote.get('total_sell_quantity', quote.get('total_sell_qty'))
                            })
                            logger.info(f"Updated watchlist item {item.get('tradingsymbol')} with market data")

                # 2. Update the subscription for market data feed to include the new items
                global upstox_subscribed_instrument_keys
                updated_instruments = set(upstox_subscribed_instrument_keys).union(new_added_items)
                if updated_instruments != upstox_subscribed_instrument_keys:
                    logger.info(f"Updating market data subscription to include new watchlist items")
                    handle_subscribe_upstox_market_data({'instrument_keys': list(updated_instruments)})
            except Exception as e:
                logger.error(f"Error initializing market data for new watchlist items: {e}", exc_info=True)
                # Don't fail if we can't fetch initial market data, the watchlist is still saved

        return jsonify({
            "success": True,
            "watchlist": processed_watchlist
        })

    except Exception as e:
        logger.error(f"Error saving watchlist: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/search-upstox-symbols')
@require_login
def search_upstox_symbols():
    """API endpoint to search Upstox symbols"""
    try:
        query = request.args.get('query', '')
        if not query or len(query) < 2:
            return jsonify({"success": True, "symbols": []})

        # Get Upstox client
        upstox_api_client = upstox_service.get_configuration_api_client()
        if not upstox_api_client:
            logger.error("Failed to get Upstox ApiClient for symbol search.")
            return jsonify({"success": False, "error": "Upstox authentication failed"}), 401

        # Search for symbols using Upstox service
        search_results = upstox_service.search_symbols(upstox_api_client, query)

        return jsonify({"success": True, "symbols": search_results})

    except Exception as e:
        logger.error(f"Error searching Upstox symbols: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/login_upstox')
def login_upstox():
    """Initiate Upstox login flow based on official documentation"""
    # Save Zerodha (Kite) authentication data if it exists
    kite_access_token = session.get('kite_access_token')
    kite_public_token = session.get('kite_public_token')
    user_profile = session.get('user_profile')

    # Clear session but keep Zerodha data if authenticated
    session.clear()

    # Restore Zerodha authentication data if it was present
    if kite_access_token:
        session['kite_access_token'] = kite_access_token
        session['kite_public_token'] = kite_public_token
        session['user_profile'] = user_profile

    if not os.getenv('UPSTOX_API_KEY') or not os.getenv('UPSTOX_API_SECRET'):
        logger.error("Missing Upstox API credentials in environment variables.")
        return render_template('layout.html', error="Upstox API credentials not configured. Please check server logs.")

    try:
        # Generate authorization URL for Upstox OAuth following official documentation
        redirect_uri = os.getenv('UPSTOX_REDIRECT_URI', 'http://localhost:6010/upstox_callback')

        auth_params = {
            "client_id": os.getenv('UPSTOX_API_KEY'),
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "orders data_feed"  # Add required scopes as per documentation
        }

        # Build the authorization URL
        auth_url = "https://api.upstox.com/v2/login/authorization/dialog"
        auth_url += "?" + "&".join([f"{key}={value}" for key, value in auth_params.items()])

        logger.info(f"Generated Upstox login URL: {auth_url}")
        return redirect(auth_url)

    except Exception as e:
        logger.error(f"Error generating Upstox authorization URL: {str(e)}")
        return render_template('layout.html', error="Failed to generate Upstox login URL.")

@app.route('/upstox_callback')
def upstox_callback():
    """Handle callback from Upstox OAuth flow as per official documentation"""
    try:
        # Save Zerodha (Kite) authentication data if it exists
        kite_access_token = session.get('kite_access_token')
        kite_public_token = session.get('kite_public_token')
        user_profile = session.get('user_profile')

        # Get the authorization code from the request
        auth_code = request.args.get('code')
        if not auth_code:
            logger.error("No authorization code found in Upstox callback")
            return render_template('layout.html', error="No authorization code received from Upstox.")

        api_key = os.getenv('UPSTOX_API_KEY')
        api_secret = os.getenv('UPSTOX_API_SECRET')
        redirect_uri = os.getenv('UPSTOX_REDIRECT_URI', 'http://localhost:6010/upstox_callback')

        # Exchange the authorization code for an access token per official docs
        token_url = "https://api.upstox.com/v2/login/authorization/token"
        token_data = {
            "code": auth_code,
            "client_id": api_key,
            "client_secret": api_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code"
        }

        response = requests.post(token_url, data=token_data)
        response.raise_for_status()

        token_response = response.json()

        # Extract and store tokens
        access_token = token_response.get('access_token')
        refresh_token = token_response.get('refresh_token')
        expires_in = token_response.get('expires_in', 86400)  # Default to 24 hours

        if not access_token:
            logger.error("No access token received from Upstox")
            return render_template('layout.html', error="Failed to obtain access token from Upstox.")

        # Calculate expiry time
        expiry_time = datetime.now() + timedelta(seconds=expires_in)

        # Store tokens in session while preserving Kite data
        if kite_access_token:
            session['kite_access_token'] = kite_access_token
            session['kite_public_token'] = kite_public_token
            session['user_profile'] = user_profile

        session['upstox_access_token'] = access_token
        session['upstox_refresh_token'] = refresh_token
        session['upstox_token_expiry'] = expiry_time.isoformat()
        session['upstox_authenticated'] = True

        # Use the upstox_service function to save token in memory only
        from upstox_service import save_access_token
        save_access_token(access_token, expires_in)
        logger.info("Successfully authenticated with Upstox and saved token to memory")

        # Fetch user profile from Upstox if needed
        try:
            # Use the access token to make a request to Upstox Profile API
            headers = {
                'Accept': 'application/json',
                'Api-Version': '2.0',
                'Authorization': f'Bearer {access_token}'
            }
            profile_url = "https://api.upstox.com/v2/user/profile"
            profile_response = requests.get(profile_url, headers=headers)
            profile_response.raise_for_status()

            upstox_profile = profile_response.json().get('data', {})
            session['upstox_profile'] = upstox_profile
            logger.info("Successfully fetched Upstox user profile")
        except Exception as e:
            logger.error(f"Error fetching Upstox user profile: {e}")
            # Continue even if profile fetch fails

        return redirect('/')  # Redirect to home page instead of dashboard
    except Exception as e:
        logger.error(f"Error in Upstox callback: {str(e)}")
        if hasattr(e, 'response') and e.response is not None:
            logger.error(f"Upstox API error response: {e.response.text}")
        return render_template('layout.html', error=f"Error during Upstox authentication: {str(e)}")

@app.route('/api/historical-data')
@require_login
def fetch_historical_data():
    """API endpoint to fetch historical candle data for a symbol"""
    try:
        symbol = request.args.get('symbol')
        exchange = request.args.get('exchange', 'NSE_EQ')
        interval = request.args.get('interval', '1day')
        from_date = request.args.get('from_date')
        to_date = request.args.get('to_date')

        if not symbol:
            return jsonify({"success": False, "error": "Symbol is required"}), 400

        # Get Upstox client
        upstox_api_client = upstox_service.get_configuration_api_client()
        if not upstox_api_client:
            logger.error("Failed to get Upstox ApiClient for historical data.")
            return jsonify({"success": False, "error": "Upstox authentication failed"}), 401

        # Fetch historical data using upstox_service
        historical_data = upstox_service.get_historical_data(
            symbol=symbol,
            interval=interval,
            from_date=from_date,
            to_date=to_date,
            exchange=exchange
        )

        if historical_data is None:
            return jsonify({"success": False, "error": "Failed to fetch historical data"}), 500

        return jsonify({
            "success": True,
            "data": historical_data
        })

    except Exception as e:
        logger.error(f"Error fetching historical data: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/merged-chart-data')
@require_login
def fetch_merged_chart_data():
    """API endpoint to fetch and merge historical and intraday data for a complete chart view"""
    try:
        tradingsymbol = request.args.get('tradingsymbol')
        exchange = request.args.get('exchange', 'NSE_EQ')
        interval = request.args.get('interval', '1day')
        from_date = request.args.get('from_date')
        to_date = request.args.get('to_date')

        if not tradingsymbol:
            return jsonify({"success": False, "error": "tradingsymbol is required"}), 400

        # Get instrument_key from cache based on tradingsymbol
        instrument_key = upstox_service.get_instrument_key_from_cache(tradingsymbol)

        if not instrument_key:
            logger.error(f"Could not find instrument_key for tradingsymbol: {tradingsymbol}")
            return jsonify({"success": False, "error": f"Could not find instrument details for {tradingsymbol}"}), 404

        # Get Upstox client
        upstox_api_client = upstox_service.get_configuration_api_client()
        if not upstox_api_client:
            logger.error("Failed to get Upstox ApiClient for chart data.")
            return jsonify({"success": False, "error": "Upstox authentication failed"}), 401

        # Define available intervals for both data sources
        intraday_intervals = ["1minute", "3minute", "5minute", "15minute", "30minute", "1hour"]
        historical_intervals = ["1minute", "3minute", "5minute", "15minute", "30minute", "1hour", "1day", "1week", "1month"]

        # Determine if we can fetch data from each source based on the requested interval
        fetch_intraday = interval in intraday_intervals  # Only fetch intraday for supported intervals
        fetch_historical = interval in historical_intervals

        historical_data = None
        intraday_data = None

        logger.info(f"Fetching data for {tradingsymbol} (instrument_key: {instrument_key}) with interval {interval}")

        # Step 1: Get historical data using the requested interval
        if fetch_historical:
            historical_data = upstox_service.get_historical_data(
                instrument_key=instrument_key,
                interval=interval,
                from_date=from_date,
                to_date=to_date,
                exchange=exchange
            )

            if historical_data:
                logger.info(f"Retrieved {len(historical_data)} historical candles with interval {interval}")
            else:
                logger.warning(f"No historical data available for {instrument_key} with interval {interval}")

        # Step 2: Get intraday data for recent updates (only for supported intervals)
        if fetch_intraday:
            intraday_data = upstox_service.get_intra_day_candle_data(
                instrument_key=instrument_key,
                interval=interval,
                exchange=exchange
            )

            if intraday_data:
                logger.info(f"Retrieved {len(intraday_data)} intraday candles with interval {interval}")
            else:
                logger.info(f"No intraday data available for {instrument_key} with interval {interval}")
        else:
            # For intervals like "1day", "1week", "1month", intraday data isn't available
            logger.info(f"Intraday data not supported for interval {interval}, using historical data only")

        # Step 3: Handle case where we only have one data source
        if not historical_data and not intraday_data:
            return jsonify({"success": False, "error": f"No data available for {instrument_key} with interval {interval}"}), 404

        if not historical_data and intraday_data:
            logger.info(f"Only intraday data available for {interval}")
            return jsonify({"success": True, "data": intraday_data})

        if historical_data and not intraday_data:
            logger.info(f"Only historical data available for {interval}")
            return jsonify({"success": True, "data": historical_data})

        # Step 4: Merge the data when both sources are available
        logger.info(f"Merging historical and intraday data for {interval}")
        merged_data = upstox_service.merge_historical_and_intraday_data(
            historical_data=historical_data,
            intraday_data=intraday_data,
            interval=interval
        )

        if not merged_data:
            # If merge fails, return historical data as fallback
            logger.warning("Merge failed, returning historical data as fallback")
            return jsonify({"success": True, "data": historical_data})

        logger.info(f"Returning merged data with {len(merged_data)} candles")
        return jsonify({"success": True, "data": merged_data})

    except Exception as e:
        logger.error(f"Error fetching merged chart data: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

def on_upstox_market_data(feed_response):
    """
    Callback function for processing market data from Upstox WebSocket.
    Extracts LTPC data and updates the watchlist data.

    Args:
        feed_response: FeedResponse object from Upstox WebSocket
    """
    global watchlist_ltpc_data

    # Use the extract_ltpc_from_feed function to get LTPC data
    ltpc_data = upstox_service.extract_ltpc_from_feed(feed_response)

    if ltpc_data:
        # Update the global watchlist LTPC data
        watchlist_ltpc_data.update(ltpc_data)

        # Emit the updated data to connected clients via Socket.IO
        for instrument_key, data in ltpc_data.items():
            data['instrument_key'] = instrument_key
            socketio.emit('ltpc_update', data)

        logger.info(f"Updated LTPC data for {len(ltpc_data)} instruments and broadcast to clients")
    else:
        logger.debug("No LTPC data extracted from market feed")

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0')
