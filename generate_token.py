# This script loads Fyers API credentials from the .env file.
# It guides the user through obtaining an auth_code by visiting a URL,
# then prompts the user to paste the redirect URL to extract the auth_code,
# and finally uses it to fetch an access token and profile.
from fyers_apiv3 import fyersModel
import os
from dotenv import load_dotenv, set_key
from urllib.parse import urlparse, parse_qs

# Load environment variables from .env
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=dotenv_path, override=True)

client_id = os.getenv("FYERS_CLIENT_ID")
secret_key = os.getenv("FYERS_SECRET_KEY")
redirect_uri = os.getenv("REDIRECT_URI") # This is your app's callback URL
response_type = "code"
grant_type = "authorization_code"
state = os.getenv("STATE", "sample_state")

if not all([client_id, secret_key, redirect_uri]):
    print("Error: FYERS_CLIENT_ID, FYERS_SECRET_KEY, or REDIRECT_URI not set in .env file.")
    exit(1)

print("--- Step 1: Get Authorization URL ---")
# Create a session model to generate auth code URL
session_for_authcode = fyersModel.SessionModel(
    client_id=client_id,
    secret_key=secret_key,
    redirect_uri=redirect_uri,
    response_type=response_type,
    state=state
)
auth_url = session_for_authcode.generate_authcode()
print(f"Please visit this URL in your browser to authorize the application:\n{auth_url}")
print("\nAfter successful authorization, Fyers will redirect your browser.")

# Prompt user to paste the full redirect URL
full_redirect_url_from_user = input("Please paste the full redirect URL from your browser here: ").strip()

# Parse the auth_code from the pasted URL
parsed_url = urlparse(full_redirect_url_from_user)
query_params = parse_qs(parsed_url.query)
auth_code = query_params.get('auth_code', [None])[0]

if not auth_code:
    print("\nError: Could not extract 'auth_code' from the URL you pasted.")
    print("Please ensure you paste the complete URL from your browser after Fyers redirects you.")
    print("It should look like: http://your-redirect-uri/path?s=ok&code=200&auth_code=XXXXXX&state=...")
    exit(1)

print(f"\nExtracted AUTH_CODE: {auth_code}")
print("\n--- Step 2: Get Access Token and Profile --- ")

# Create a session model to generate access token
session_for_token = fyersModel.SessionModel(
    client_id=client_id,
    secret_key=secret_key,
    redirect_uri=redirect_uri,
    response_type=response_type,
    grant_type=grant_type
)
session_for_token.set_token(auth_code) # Set the extracted auth_code

try:
    token_response = session_for_token.generate_token()
    print("\nToken Generation Response:")
    print(token_response)

    if token_response.get("s") == "ok" and token_response.get("access_token"):
        generated_access_token = token_response["access_token"]
        print(f"\nSuccessfully obtained Access Token: {generated_access_token}")

        # Optionally, save the access token to .env for other scripts
        # To enable, uncomment the next two lines:
        # set_key(dotenv_path, "ACCESS_TOKEN", generated_access_token)
        # print(f"Access token has been saved to '{dotenv_path}' as ACCESS_TOKEN.")

        print("\n--- Fetching Profile --- ")
        logs_dir = os.path.join(os.getcwd(), "logs")
        os.makedirs(logs_dir, exist_ok=True)

        fyers_profile_model = fyersModel.FyersModel(
            client_id=client_id,
            token=generated_access_token,
            log_path=logs_dir
        )
        profile_response = fyers_profile_model.get_profile()
        print("\nProfile Response:")
        print(profile_response)
    else:
        print("\nFailed to obtain access token. Cannot fetch profile.")
        error_message = token_response.get('message', 'No specific error message provided by Fyers.')
        print(f"Fyers API Error: {error_message} (Code: {token_response.get('code')})")

except Exception as e:
    print(f"An error occurred: {e}")
