from fyers_apiv3 import fyersModel
import os
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

client_id = os.getenv("FYERS_CLIENT_ID")
access_token = os.getenv("ACCESS_TOKEN")  # Set this in your .env after OAuth

if not client_id or not access_token:
    raise ValueError("FYERS_CLIENT_ID or ACCESS_TOKEN not set in .env file.")

# Initialize the FyersModel instance
fyers = fyersModel.FyersModel(client_id=client_id, is_async=False, token=access_token, log_path="")

# Make a request to get the user profile information
response = fyers.get_profile()

# Print the response received from the Fyers API
print(response)

