# This script loads Kite API credentials from the .env file.
# It guides the user through obtaining a request_token by visiting a URL,
# then prompts the user to paste the redirect URL to extract the request_token,
# and finally uses it to fetch an access token and profile.
from kiteconnect import KiteConnect
import os
from dotenv import load_dotenv, set_key
from urllib.parse import urlparse, parse_qs
import logging

# Setup logging
logging.basicConfig(level=logging.DEBUG)

# Load environment variables from .env
dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=dotenv_path, override=True)

api_key = os.getenv("KITE_API_KEY")
api_secret = os.getenv("KITE_API_SECRET")
redirect_uri = os.getenv("REDIRECT_URI") # This is your app's callback URL

if not all([api_key, api_secret, redirect_uri]):
    print("Error: KITE_API_KEY, KITE_API_SECRET, or REDIRECT_URI not set in .env file.")
    exit(1)

print("--- Step 1: Get Login URL ---")
kite = KiteConnect(api_key=api_key)

login_url = kite.login_url()
print(f"Please visit this URL in your browser to authorize the application:\n{login_url}")
print("\nAfter successful authorization, Kite will redirect your browser to your redirect_uri.")

# Prompt user to paste the full redirect URL
full_redirect_url_from_user = input("Please paste the full redirect URL from your browser here: ").strip()

# Parse the request_token from the pasted URL
parsed_url = urlparse(full_redirect_url_from_user)
query_params = parse_qs(parsed_url.query)
request_token = query_params.get('request_token', [None])[0]

if not request_token:
    print("\nError: Could not extract 'request_token' from the URL you pasted.")
    print("Please ensure you paste the complete URL from your browser after Kite redirects you.")
    print(f"It should look like: {redirect_uri}?request_token=XXXXXX&action=login&status=success")
    exit(1)

print(f"\nExtracted REQUEST_TOKEN: {request_token}")
print("\n--- Step 2: Get Access Token and Profile --- ")

try:
    # Generate session using the request_token
    data = kite.generate_session(request_token, api_secret=api_secret)
    access_token = data["access_token"]
    public_token = data["public_token"] # Kite specific
    print(f"\nSuccessfully obtained Access Token: {access_token}")
    print(f"Successfully obtained Public Token: {public_token}")


    # Optionally, save the access token and public token to .env for other scripts
    set_key(dotenv_path, "KITE_ACCESS_TOKEN", access_token)
    set_key(dotenv_path, "KITE_PUBLIC_TOKEN", public_token) # Store public_token if needed
    print(f"Access token and public token have been saved to '{dotenv_path}'.")

    # Set access token for subsequent API calls
    kite.set_access_token(access_token)

    print("\n--- Fetching Profile --- ")
    profile = kite.profile()
    print("\nProfile Response:")
    print(profile)

except Exception as e:
    print(f"An error occurred: {e}")
