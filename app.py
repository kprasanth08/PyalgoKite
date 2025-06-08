from flask import Flask, render_template, request, redirect, session, jsonify
from fyers_apiv3 import fyersModel
from fyers_apiv3.FyersWebsocket import data_ws
from dotenv import load_dotenv
import os
from datetime import datetime, timedelta
import logging
from urllib.parse import quote
from flask_socketio import SocketIO, emit
import threading

# Ensure logs directory exists
log_dir = os.path.join(os.getcwd(), "logs") # os.getcwd() will be /app in container
os.makedirs(log_dir, exist_ok=True)
log_file_path = os.path.join(log_dir, "pyalgo.log")

# Configure THIS module's logger (which is likely the main app logger)
# Gunicorn will load app.py, so __name__ will be the module name (e.g., 'app')
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# Prevent duplicate handlers if Gunicorn reloads or for multiple workers in some setups
if not logger.handlers:
    # Console Handler (always add)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_formatter)
    logger.addHandler(console_handler)

    # File Handler (attempt to add)
    try:
        file_handler = logging.FileHandler(log_file_path)
        file_handler.setFormatter(log_formatter)
        logger.addHandler(file_handler)
        # Initial log to confirm file handler setup (will go to both if successful, then primarily to console if file fails next)
        logger.info(f"File logging configured to {log_file_path}.")
    except PermissionError:
        logger.warning(f"Permission denied for log file {log_file_path}. File logging is disabled. Check host volume permissions.")
    except Exception as e:
        logger.warning(f"Failed to set up file logging for {log_file_path} due to: {e}. File logging is disabled.")
else:
    # This case might be hit if Gunicorn workers share some parent logger state or due to reloads.
    # Ensuring handlers are not duplicated is key.
    logger.info("Logger already has handlers. Skipping basic handler setup.")

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('APP_SECRET_KEY')
socketio = SocketIO(app)

# Fyers API Configuration
client_id = os.getenv('FYERS_CLIENT_ID')
secret_key = os.getenv('FYERS_SECRET_KEY')
redirect_uri = os.getenv('REDIRECT_URI')

# Global WebSocket client and thread for the dashboard chart
dashboard_ws_client = None
dashboard_ws_thread = None

# Global WebSocket client and thread for order updates
order_ws_client = None
order_ws_thread = None

def get_access_token():
    if 'access_token' in session:
        return session['access_token']
    return None

def dashboard_fyers_websocket_task(access_token, symbols_to_subscribe):
    """
    Task to run in a separate thread for handling Fyers WebSocket
    for the dashboard.
    """
    global dashboard_ws_client
    logger.info(f"Dashboard WebSocket task started for symbols: {symbols_to_subscribe}")

    def on_message(message):
        # Relay message to the dashboard via SocketIO
        socketio.emit('dashboard_chart_data', message)

    def on_error(message):
        logger.error(f"Dashboard WS Error: {message}")
        socketio.emit('dashboard_chart_data', {'error': 'WebSocket error occurred'})

    def on_close(message):
        logger.info(f"Dashboard WS Closed: {message}")
        socketio.emit('dashboard_chart_data', {'status': 'WebSocket closed'})

    def on_open():
        logger.info("Dashboard WS Connection Opened.")
        if dashboard_ws_client:
            dashboard_ws_client.subscribe(symbols=symbols_to_subscribe, data_type="symbolData")
            socketio.emit('dashboard_chart_data', {'status': f'Subscribed to {symbols_to_subscribe}'})
        else:
            logger.error("Dashboard WS client not initialized at on_open.")

    fyers_log_dir = os.path.dirname(log_file_path)

    dashboard_ws_client = data_ws.FyersDataSocket(
        access_token=f"{client_id}:{access_token}",
        log_path=fyers_log_dir,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
        on_connect=on_open
    )

    try:
        dashboard_ws_client.connect()
    except Exception as e:
        logger.error(f"Failed to connect dashboard WebSocket: {e}")
        socketio.emit('dashboard_chart_data', {'error': f'Failed to connect WebSocket: {e}'})
    finally:
        logger.info("Dashboard WebSocket task finished.")

def order_update_fyers_websocket_task(access_token):
    """
    Task to run in a separate thread for handling Fyers WebSocket for order updates.
    """
    global order_ws_client
    logger.info(f"Order Update WebSocket task started.")

    def on_order_message(message):
        logger.info(f"Order Update WS Message: {message}")
        socketio.emit('fyers_order_update', message)

    def on_order_error(message):
        logger.error(f"Order Update WS Error: {message}")
        socketio.emit('fyers_order_update', {'error': 'Order Update WebSocket error occurred'})

    def on_order_close(message):
        logger.info(f"Order Update WS Closed: {message}")
        socketio.emit('fyers_order_update', {'status': 'Order Update WebSocket closed'})

    def on_order_open():
        logger.info("Order Update WS Connection Opened.")
        if order_ws_client:
            order_ws_client.subscribe(data_type="orderUpdate") # No symbols needed for order updates
            socketio.emit('fyers_order_update', {'status': 'Subscribed to order updates'})
        else:
            logger.error("Order Update WS client not initialized at on_open.")

    fyers_log_dir = os.path.dirname(log_file_path)

    order_ws_client = data_ws.FyersDataSocket(
        access_token=f"{client_id}:{access_token}", # Format: APP_ID:ACCESS_TOKEN
        log_path=fyers_log_dir,
        on_message=on_order_message,
        on_error=on_order_error,
        on_close=on_order_close,
        on_connect=on_order_open
    )

    try:
        order_ws_client.connect()
    except Exception as e:
        logger.error(f"Failed to connect Order Update WebSocket: {e}")
        socketio.emit('fyers_order_update', {'error': f'Failed to connect Order Update WebSocket: {e}'})
    finally:
        logger.info("Order Update WebSocket task finished.")

@app.route('/search-nse-symbols', methods=['GET'])
def search_nse_symbols():
    access_token = get_access_token()
    if not access_token:
        return jsonify({"error": "User not authenticated"}), 401

    query = request.args.get('query', '')
    if not query or len(query) < 2: # Minimum query length for searching
        return jsonify([]) # Return empty list if query too short, frontend handles "No results"

    try:
        # Initialize FyersModel instance
        fyers_instance = fyersModel.FyersModel(
            client_id=client_id, # Global client_id from .env
            token=access_token,
            log_path=os.path.dirname(log_file_path) # Use the log directory
        )

        # --- START OF ACTUAL FYERS API CALL FOR SYMBOL SEARCH ---
        # IMPORTANT: Verify the method name, parameters, and response structure
        # with the official Fyers API v3 documentation.
        logger.info(f"Attempting Fyers API symbol search for: {query}")

        # Hypothetical payload and method call. Adjust as per Fyers API v3 docs.
        # Common parameters include search text, exchange, and instrument type.
        payload = {
            "stext": query,    # Search text
            "exch": "NSE",     # Exchange (e.g., "NSE", "BSE", "MCX")
            "type": "EQUITY"   # Instrument type (e.g., "EQUITY", "FUT", "OPT")
                               # Check Fyers docs for exact values (e.g., it might be numeric)
        }

        # Replace 'search_symbols' with the actual method from the Fyers SDK if different.
        # The FyersModel instance (fyers_instance) should have a method for this.
        # It might be something like fyers_instance.data_api.search_symbols(data=payload)
        # or fyers_instance.search_scrips(data=payload)
        # Attempting with symbol_search as an alternative
        api_response = fyers_instance.symbol_search(data=payload) # HYPOTHETICAL: Changed from search_symbols

        logger.info(f"Fyers API search response: {api_response}")

        if api_response and api_response.get("s") == "ok" and "data" in api_response:
            search_results_from_api = api_response["data"]
            processed_results = []
            if isinstance(search_results_from_api, list): # Ensure data is a list
                for item in search_results_from_api:
                    # Adjust these keys based on the actual Fyers API response structure.
                    # Common keys for symbol: "symbol", "fyToken", "instrumentIdentifier"
                    # Common keys for description: "description", "longName", "companyName", "scripName"

                    # Example: Fyers often returns 'symbol' like 'NSE:SBIN-EQ' and 'description' or 'longName'.
                    api_symbol = item.get("symbol")
                    api_description = item.get("description") or item.get("longName") or item.get("scripName")

                    if api_symbol and api_description:
                        processed_results.append({"symbol": api_symbol, "description": api_description})
                    else:
                        logger.warning(f"Skipping item due to missing symbol or description: {item}")
            else:
                logger.error(f"Fyers API returned data in unexpected format: {search_results_from_api}")
                return jsonify({"error": "Received unexpected data format from Fyers API"}), 500

            logger.info(f"Processed symbol search results for '{query}': {processed_results}")
            return jsonify(processed_results)
        else:
            error_message = "Unknown error during Fyers API symbol search."
            if api_response and api_response.get("message"):
                error_message = api_response.get("message")
            elif not api_response:
                error_message = "No response from Fyers API for symbol search."

            logger.error(f"Fyers symbol search API error: {error_message} | Full response: {api_response}")
            return jsonify({"error": error_message}), 500
        # --- END OF ACTUAL FYERS API CALL FOR SYMBOL SEARCH ---

    except Exception as e:
        logger.error(f"Error in search_nse_symbols: {str(e)}")
        return jsonify({"error": "An internal error occurred during symbol search"}), 500

@socketio.on('connect_dashboard_ws')
def handle_connect_dashboard_ws(data):
    """
    Handles request from client to start/manage dashboard WebSocket.
    'data' can include {'symbols': ['NSE:SBIN-EQ', 'NSE:RELIANCE-EQ']}
    """
    global dashboard_ws_thread, dashboard_ws_client
    access_token = get_access_token()

    if not access_token:
        emit('dashboard_chart_data', {'error': 'User not authenticated'})
        return

    symbols = data.get('symbols', ["NSE:SBIN-EQ"])
    logger.info(f"Request to connect dashboard WebSocket for symbols: {symbols}")

    if dashboard_ws_thread and dashboard_ws_thread.is_alive():
        logger.info("Dashboard WebSocket thread is already running.")
        if dashboard_ws_client and hasattr(dashboard_ws_client, 'is_connected') and dashboard_ws_client.is_connected():
            logger.info("Attempting to update subscription for already connected WebSocket.")
            dashboard_ws_client.subscribe(symbols=symbols, data_type="symbolData")
            emit('dashboard_chart_data', {'status': f'Updated subscription to {symbols}'})
            return
        else:
            logger.info("Dashboard WebSocket thread is alive but client not connected or accessible. Attempting to restart.")

    logger.info("Starting new Dashboard WebSocket thread.")
    dashboard_ws_thread = threading.Thread(
        target=dashboard_fyers_websocket_task,
        args=(access_token, symbols),
        daemon=True
    )
    dashboard_ws_thread.start()
    emit('dashboard_chart_data', {'status': f'Dashboard WebSocket connection process started for {symbols}'})

@socketio.on('disconnect_dashboard_ws')
def handle_disconnect_dashboard_ws():
    global dashboard_ws_thread, dashboard_ws_client
    logger.info("Request to disconnect dashboard WebSocket.")
    if dashboard_ws_client and hasattr(dashboard_ws_client, 'stop_websocket'):
        dashboard_ws_client.stop_websocket(expected_close=True)
        dashboard_ws_client = None
    if dashboard_ws_thread and dashboard_ws_thread.is_alive():
        logger.info("Dashboard WebSocket thread was running. It should stop if WebSocket is closed.")
    dashboard_ws_thread = None
    emit('dashboard_chart_data', {'status': 'Dashboard WebSocket disconnected'})

@socketio.on('connect_order_updates')
def handle_connect_order_updates():
    """
    Handles request from client to start Fyers WebSocket for order updates.
    """
    global order_ws_thread
    access_token = get_access_token()

    if not access_token:
        emit('fyers_order_update', {'error': 'User not authenticated for order updates'})
        return

    logger.info(f"Request to connect Order Update WebSocket.")

    if order_ws_thread and order_ws_thread.is_alive():
        logger.info("Order Update WebSocket thread is already running.")
        emit('fyers_order_update', {'status': 'Order Update WebSocket already active'})
        return

    logger.info("Starting new Order Update WebSocket thread.")
    order_ws_thread = threading.Thread(
        target=order_update_fyers_websocket_task,
        args=(access_token,),
        daemon=True
    )
    order_ws_thread.start()
    emit('fyers_order_update', {'status': 'Order Update WebSocket connection process started'})

@socketio.on('disconnect_order_updates')
def handle_disconnect_order_updates():
    global order_ws_thread, order_ws_client
    logger.info("Request to disconnect Order Update WebSocket.")
    if order_ws_client and hasattr(order_ws_client, 'stop_websocket'):
        order_ws_client.stop_websocket(expected_close=True)
        order_ws_client = None
    if order_ws_thread and order_ws_thread.is_alive():
        logger.info("Order Update WebSocket thread was running. It should stop if WebSocket is closed.")
    order_ws_thread = None
    emit('fyers_order_update', {'status': 'Order Update WebSocket disconnected'})

@app.route('/')
def index():
    if not get_access_token():
        return redirect('/login')
    return redirect('/dashboard')

@app.route('/login')
def login():
    session.clear()
    client_id_local = os.getenv("FYERS_CLIENT_ID")
    secret_key_local = os.getenv("FYERS_SECRET_KEY")
    redirect_uri_local = os.getenv("REDIRECT_URI")
    response_type = "code"
    state = os.getenv("STATE", "sample_state")

    if not all([client_id_local, secret_key_local, redirect_uri_local]):
        logger.error("Missing required environment variables: FYERS_CLIENT_ID, FYERS_SECRET_KEY, or REDIRECT_URI.")
        return render_template('layout.html', error="Missing required environment variables. Please check your .env file.")

    session_model = fyersModel.SessionModel(
        client_id=client_id_local,
        secret_key=secret_key_local,
        redirect_uri=redirect_uri_local,
        response_type=response_type,
        state=state
    )

    auth_url = session_model.generate_authcode()
    logger.info(f"Authcode response: {auth_url}")
    if isinstance(auth_url, str) and auth_url.startswith("http"):
        return redirect(auth_url)
    else:
        return render_template('layout.html', error=f"Failed to generate auth URL: {auth_url}")

@app.route('/fyers-callback')
def fyers_callback():
    auth_code = request.args.get('auth_code')
    state_received = request.args.get('state') # Optional: validate state if you sent one
    error = request.args.get('error')

    if error:
        logger.error(f"Fyers callback error: {error}")
        return render_template('layout.html', error=f"Fyers callback error: {error}")
    if not auth_code:
        logger.error("No auth_code received in Fyers callback.")
        return render_template('layout.html', error="No auth_code received from Fyers.")

    # Use Fyers SDK SessionModel to exchange auth_code for access token
    try:
        session_model_for_token = fyersModel.SessionModel(
            client_id=client_id, # Global client_id (App ID Hash)
            secret_key=secret_key, # Global secret_key
            redirect_uri=redirect_uri, # Global redirect_uri
            response_type="code", # Standard for auth code flow
            grant_type="authorization_code" # Standard for auth code flow
        )
        session_model_for_token.set_token(auth_code)
        token_response = session_model_for_token.generate_token()

        logger.info(f"Token Generation Response via SDK: {token_response}")

        if token_response.get("s") == "ok" and token_response.get("access_token"):
            session['access_token'] = token_response["access_token"]
            logger.info(f"Access token obtained and stored in session.")

            # Fetch user profile immediately after getting the access token
            try:
                fyers_profile_model = fyersModel.FyersModel(
                    client_id=client_id,
                    token=session['access_token'],
                    log_path=os.path.dirname(log_file_path) # Use the log directory
                )
                profile_response = fyers_profile_model.get_profile()
                logger.info(f"Profile fetch response in callback: {profile_response}")

                if profile_response.get("s") == "ok" and profile_response.get("data"):
                    session['user_profile'] = profile_response["data"]
                    logger.info("User profile fetched and stored in session by callback.")
                else:
                    logger.error(f"Failed to fetch profile in callback: {profile_response.get('message')}")
                    session.pop('user_profile', None) # Clear any stale profile data

            except Exception as e_profile:
                logger.error(f"Error fetching profile in callback: {str(e_profile)}")
                session.pop('user_profile', None) # Clear any stale profile data

            return redirect('/dashboard')
        else:
            error_message = token_response.get('message', 'Failed to obtain access token via SDK.')
            logger.error(f"Token exchange failed via SDK: {error_message} | Full response: {token_response}")
            return render_template('layout.html', error=f"Token exchange failed: {error_message}")

    except Exception as e_token:
        logger.error(f"Error during SDK token generation: {str(e_token)}")
        return render_template('layout.html', error=f"An error occurred during token generation: {str(e_token)}")

@app.route('/profile')
def user_profile():
    access_token = get_access_token()
    if not access_token:
        return redirect('/login')

    user_profile_data = session.get('user_profile')
    if user_profile_data:
        logger.info("Using user profile from session for /profile page.")
        return render_template('profile.html', profile=user_profile_data)
    else:
        # Attempt to fetch if not in session (e.g., direct navigation after session clear but token still valid)
        logger.info("User profile not in session for /profile, attempting to fetch.")
        try:
            fyers_instance = fyersModel.FyersModel(client_id=client_id, token=access_token, is_async=False, log_path=os.path.dirname(log_file_path))
            profile_response = fyers_instance.get_profile()
            if profile_response.get("s") == "ok" and profile_response.get("data"):
                session['user_profile'] = profile_response["data"]
                return render_template('profile.html', profile=profile_response["data"])
            else:
                logger.error(f"/profile: Profile fetch failed: {profile_response.get('message')}")
                session.pop('access_token', None)
                session.pop('user_profile', None)
                return redirect('/login')
        except Exception as e:
            logger.error(f"/profile: Error fetching profile: {str(e)}")
            session.clear()
            return redirect('/login')

@app.route('/dashboard')
def dashboard():
    access_token = get_access_token()
    if not access_token:
        return redirect('/login')

    # Dashboard will now primarily focus on watchlist and chart
    # We can pass the user's name for a personalized welcome if desired, fetched if not in session
    user_name = "User"
    user_profile_data = session.get('user_profile')
    if user_profile_data and 'name' in user_profile_data:
        user_name = user_profile_data['name']
    elif not user_profile_data: # If no profile in session, try a quick fetch for name
        try:
            fyers_instance = fyersModel.FyersModel(client_id=client_id, token=access_token, is_async=False, log_path=os.path.dirname(log_file_path))
            profile_response = fyers_instance.get_profile()
            if profile_response.get("s") == "ok" and profile_response.get("data"):
                session['user_profile'] = profile_response["data"] # Store full profile
                user_name = profile_response["data"].get('name', "User")
        except Exception as e:
            logger.warning(f"Dashboard: Could not fetch profile for name display: {e}")
            # Continue without name, or redirect to login if profile is critical

    return render_template('dashboard.html', user_name=user_name)

@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')

@app.route('/market_data')
def market_data():
    access_token = get_access_token()
    if not access_token:
        return jsonify({"error": "Not authenticated"}), 401

@app.route('/get-authcode')
def get_authcode():
    client_id = os.getenv("FYERS_CLIENT_ID")
    secret_key = os.getenv("FYERS_SECRET_KEY")
    redirect_uri = os.getenv("REDIRECT_URI")
    response_type = "code"
    state = os.getenv("STATE", "sample_state")

    if not all([client_id, secret_key, redirect_uri]):
        logger.error("Missing required environment variables: FYERS_CLIENT_ID, FYERS_SECRET_KEY, or REDIRECT_URI.")
        return render_template('layout.html', error="Missing required environment variables. Please check your .env file.")

    session_model = fyersModel.SessionModel(
        client_id=client_id,
        secret_key=secret_key,
        redirect_uri=redirect_uri,
        response_type=response_type,
        state=state
    )

    response = session_model.generate_authcode()
    logger.info(f"Authcode response: {response}")
    return render_template('layout.html', login_url=response)

@app.route('/ws-demo')
def ws_demo():
    access_token = get_access_token()
    if not access_token:
        return render_template('layout.html', error="Not authenticated. Please login first.")

    data_type = "symbolData"
    symbols = ["NSE:SBIN-EQ", "NSE:RELIANCE-EQ"]

    def onmessage(message):
        logger.info(f"WebSocket message: {message}")
    def onerror(message):
        logger.error(f"WebSocket error: {message}")
    def onclose(message):
        logger.info(f"WebSocket closed: {message}")
    def onopen():
        logger.info("WebSocket connection opened.")
        ws.subscribe(symbols=symbols, data_type=data_type)

    ws = data_ws.FyersDataSocket(
        access_token=access_token,
        log_path=log_file_path,
        on_message=onmessage,
        on_error=onerror,
        on_close=onclose,
        on_open=onopen
    )

    import threading
    ws_thread = threading.Thread(target=ws.connect, daemon=True)
    ws_thread.start()

    return render_template('layout.html', message="WebSocket demo started. Check logs for real-time data.")

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=6010, debug=True)


