import os
from dotenv import load_dotenv
from kiteconnect import KiteConnect # Import KiteConnect

# Load environment variables from .env
load_dotenv()

api_key = os.getenv("KITE_API_KEY") # Corrected this line
access_token = os.getenv("KITE_ACCESS_TOKEN")

if not api_key or not access_token:
    print("Error: KITE_API_KEY or KITE_ACCESS_TOKEN not set in .env file.")
    # Consider raising an error or exiting if you prefer
    # raise ValueError("KITE_API_KEY or KITE_ACCESS_TOKEN not set in .env file.")
    exit(1)

# Initialize the KiteConnect instance
try:
    kite = KiteConnect(api_key=api_key)
    kite.set_access_token(access_token)

    # Fetch user profile
    profile = kite.profile()

    # Print the profile information
    print("User Profile:")
    # The profile object is a dictionary. You can print it directly
    # or iterate through its items for a more formatted output.
    print(profile)

    # Example of accessing specific profile fields:
    # print(f"User ID: {profile.get('user_id')}")
    # print(f"User Name: {profile.get('user_name')}")
    # print(f"Email: {profile.get('email')}")
    # print(f"Broker: {profile.get('broker')}")

except Exception as e:
    print(f"An error occurred: {e}")
