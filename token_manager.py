"""
Token Manager Module for handling access tokens for API authentication.
Provides a singleton class to manage and store access tokens with expiration handling.
"""

import os
import json
import logging
from datetime import datetime, timedelta

# Configure logger
logger = logging.getLogger(__name__)

class TokenManager:
    """
    Singleton class for managing API access tokens.
    Handles token storage, retrieval, and expiration.
    """
    _instance = None

    def __init__(self):
        self._token_expiry = None
        self._access_token = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TokenManager, cls).__new__(cls)
            cls._instance._access_token = None
            cls._instance._token_expiry = None
            cls._instance._token_file = os.path.join(os.getcwd(), 'upstox_token.json')
        return cls._instance

    def get_token(self):
        """
        Get or refresh access token.
        Returns the current valid token or attempts to load from file.
        
        Returns:
            str: The access token or None if not available/expired
        """
        # If token exists and not expired, return it
        if self._access_token and self._token_expiry and datetime.now() < self._token_expiry:
            return self._access_token

        # Try to read token from a file - which should be populated by the redirect callback
        if os.path.exists(self._token_file):
            try:
                with open(self._token_file, 'r') as f:
                    stored_data = json.load(f)

                # Check if token is still valid
                if stored_data.get('expires_at') and datetime.fromisoformat(stored_data['expires_at']) > datetime.now():
                    self._access_token = stored_data['access_token']
                    self._token_expiry = datetime.fromisoformat(stored_data['expires_at'])
                    logger.info(f"Loaded valid access token from file, expires at {self._token_expiry}")
                    return self._access_token
                else:
                    logger.warning("Stored token has expired")
            except Exception as e:
                logger.error(f"Error reading token file: {e}")

        # If we get here, we need a new token, but this requires user interaction
        logger.error("Authentication requires user interaction. Please use the login flow.")
        return None

    def set_token(self, access_token, expires_in=86400):
        """
        Set access token in memory with expiration time
        
        Args:
            access_token (str): The access token to save
            expires_in (int): Expiry time in seconds from now
        """
        self._access_token = access_token
        self._token_expiry = datetime.now() + timedelta(seconds=expires_in - 300)  # 5 minutes buffer
        logger.info(f"Token set in memory, expires at {self._token_expiry}")
        
    def get_expiry_time(self):
        """
        Get the expiration time of the current token
        
        Returns:
            datetime: The token expiration time or None if not set
        """
        return self._token_expiry
        
    def save_token(self, access_token, expires_in=86400):
        """
        Save access token to memory and file for persistence
        
        Args:
            access_token (str): The access token to save
            expires_in (int): Expiry time in seconds from now
        """
        # Set token in memory
        self.set_token(access_token, expires_in)

        try:
            with open(self._token_file, 'w') as f:
                json.dump({
                    'access_token': access_token,
                    'expires_at': self._token_expiry.isoformat()
                }, f)
            logger.info(f"Saved access token to file, expires at {self._token_expiry}")
        except Exception as e:
            logger.error(f"Error saving token to file: {e}")

    def clear_token(self):
        """
        Clear the current token from memory and file
        """
        self._access_token = None
        self._token_expiry = None
        
        if os.path.exists(self._token_file):
            try:
                os.remove(self._token_file)
                logger.info("Token file removed")
            except Exception as e:
                logger.error(f"Error removing token file: {e}")

# Create a singleton instance
token_manager = TokenManager()
