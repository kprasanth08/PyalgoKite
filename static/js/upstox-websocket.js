/**
 * Direct Upstox WebSocket Client
 * This module handles direct WebSocket connections to Upstox from the frontend
 */

class UpstoxWebSocket {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.subscriptions = new Set();
        this.messageHandlers = [];
        this.statusHandlers = [];
        this.errorHandlers = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000; // Start with 2 seconds
        this.protobufLoaded = false;
        this.protobufModule = null;
    }

    /**
     * Initialize the Protobuf module for message decoding
     */
    async initializeProtobuf() {
        try {
            // Check if protobuf.js is already loaded
            if (typeof protobuf === 'undefined') {
                console.error('protobuf.js library not loaded. Please include it in your HTML.');
                return false;
            }

            // Load the MarketDataFeed protobuf definition
            const response = await fetch('/static/proto/MarketDataFeed.proto');
            if (!response.ok) {
                throw new Error(`Failed to fetch protobuf definition: ${response.statusText}`);
            }

            const protoDefinition = await response.text();

            // Parse the protobuf definition
            const root = protobuf.parse(protoDefinition).root;

            // Get the FeedResponse message type
            this.FeedResponse = root.lookupType("com.upstox.marketdatafeeder.rpc.proto.FeedResponse");

            this.protobufLoaded = true;
            console.log('Protobuf initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize protobuf:', error);
            return false;
        }
    }

    /**
     * Get the WebSocket authorization URL directly from Upstox API
     * Instead of using the backend endpoint
     */
    async getAuthUrl() {
        try {
            console.log('Requesting WebSocket authorization URL directly from Upstox API...');

            // First get the authentication token
            const tokenResponse = await fetch('/api/upstox-auth-token');
            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                console.error('Failed to get auth token:', errorText);
                throw new Error(`Failed to get auth token: ${tokenResponse.status}`);
            }

            const tokenData = await tokenResponse.json();
            if (!tokenData.success || !tokenData.token) {
                throw new Error(tokenData.error || 'Invalid auth token response');
            }

            const authToken = tokenData.token;

            // Now make a direct request to the Upstox API
            const response = await fetch('https://api.upstox.com/v2/feed/market-data-feed/authorize', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });

            console.log(`Upstox API auth URL response status: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`HTTP error fetching Upstox auth URL: ${response.status}`, errorText);
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (!data.status === 'success' || !data.data || !data.data.authorized_redirect_uri) {
                console.error('Invalid Upstox auth URL response:', data);
                throw new Error('Invalid response format from Upstox API');
            }

            const wsUrl = data.data.authorized_redirect_uri;
            console.log('Successfully received WebSocket auth URL directly from Upstox API');
            return wsUrl;
        } catch (error) {
            console.error('Error getting Upstox WebSocket auth URL:', error);
            this.notifyError('Failed to get WebSocket authorization URL: ' + error.message);
            return null;
        }
    }

    /**
     * Connect to the Upstox WebSocket
     */
    async connect() {
        if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
            console.log('WebSocket connection already exists. Closing before reconnecting...');
            this.disconnect();

            // Add a small delay to ensure clean closure before reconnecting
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        try {
            // Get the WebSocket authorization URL
            const wsUrl = await this.getAuthUrl();
            if (!wsUrl) {
                this.notifyError('Failed to get WebSocket URL');
                return false;
            }

            console.log(`Attempting to connect to Upstox WebSocket with URL: ${wsUrl.substring(0, 100)}...`);

            // Initialize protobuf if not already done
            if (!this.protobufLoaded) {
                const protobufInitialized = await this.initializeProtobuf();
                if (!protobufInitialized) {
                    this.notifyError('Failed to initialize protobuf');
                    return false;
                }
            }

            // Create a new WebSocket connection with explicit protocols and timeout
            try {
                this.socket = new WebSocket(wsUrl);

                // Set up a connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (this.socket && this.socket.readyState !== WebSocket.OPEN) {
                        console.error('WebSocket connection timed out');
                        this.notifyError('Connection timeout');
                        this.socket.close();
                    }
                }, 15000); // 15 seconds timeout

                // Wait for the socket to connect or fail
                await new Promise((resolve, reject) => {
                    this.socket.onopen = () => {
                        clearTimeout(connectionTimeout);
                        this.connected = true;
                        this.reconnectAttempts = 0;
                        this.reconnectDelay = 2000;
                        this.notifyStatus('Connected');
                        console.log('Upstox WebSocket connected successfully!');

                        // Resubscribe to any instrument keys
                        this.resubscribe();
                        resolve(true);
                    };

                    this.socket.onerror = (error) => {
                        console.error('Upstox WebSocket error during connection:', error);
                        // Don't reject here as onclose will also be called
                    };

                    this.socket.onclose = (event) => {
                        clearTimeout(connectionTimeout);
                        this.connected = false;
                        console.log(`Upstox WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}`);
                        this.notifyStatus('Disconnected');

                        if (!this.connected) { // If we never connected, indicate failure
                            reject(new Error(`WebSocket connection failed with code: ${event.code}`));
                        }
                    };
                });

                // Set up message handler
                this.socket.onmessage = (event) => {
                    try {
                        // Binary message - decode with protobuf
                        if (event.data instanceof Blob) {
                            const reader = new FileReader();
                            reader.onload = () => {
                                try {
                                    const buffer = new Uint8Array(reader.result);
                                    const message = this.FeedResponse.decode(buffer);
                                    this.handleMarketData(message);
                                } catch (decodeError) {
                                    console.error('Error decoding protobuf message:', decodeError);
                                }
                            };
                            reader.readAsArrayBuffer(event.data);
                        }
                        // Text message - parse JSON
                        else {
                            const message = JSON.parse(event.data);
                            this.handleControlMessage(message);
                        }
                    } catch (e) {
                        console.error('Error handling WebSocket message:', e);
                    }
                };

                // Set up error handler for during the connection
                this.socket.onerror = (error) => {
                    console.error('Upstox WebSocket error:', error);
                    this.notifyError('WebSocket connection error');
                };

                // Set up close handler
                this.socket.onclose = (event) => {
                    this.connected = false;
                    console.log(`Upstox WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}`);
                    this.notifyStatus('Disconnected');

                    // Attempt reconnect if not a clean close
                    if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.reconnectAttempts++;
                        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

                        // Use exponential backoff with a cap
                        const delay = Math.min(30000, this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1));

                        this.notifyStatus(`Reconnecting in ${(delay/1000).toFixed(2)}s...`);
                        setTimeout(() => this.connect(), delay);
                    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        this.notifyError(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached. Please refresh the page.`);
                    }
                };

                return true;
            } catch (wsError) {
                console.error('Error creating WebSocket connection:', wsError);
                this.notifyError(`WebSocket creation error: ${wsError.message}`);
                return false;
            }
        } catch (error) {
            console.error('Error connecting to Upstox WebSocket:', error);
            this.notifyError('Failed to connect: ' + error.message);
            return false;
        }
    }

    /**
     * Disconnect from the Upstox WebSocket
     */
    disconnect() {
        if (this.socket) {
            this.socket.close(1000, 'Closed by client');
            this.socket = null;
            this.connected = false;
            this.notifyStatus('Disconnected');
        }
    }

    /**
     * Subscribe to market data for the given instrument keys
     * @param {Array} instrumentKeys - Array of instrument keys to subscribe to
     */
    subscribe(instrumentKeys) {
        if (!instrumentKeys || !instrumentKeys.length) {
            return;
        }

        // Add to local subscriptions set
        instrumentKeys.forEach(key => {
            this.subscriptions.add(key);
        });

        // If connected, send subscription message
        this.sendSubscription(instrumentKeys);
    }

    /**
     * Unsubscribe from market data for the given instrument keys
     * @param {Array} instrumentKeys - Array of instrument keys to unsubscribe from
     */
    unsubscribe(instrumentKeys) {
        if (!instrumentKeys || !instrumentKeys.length) {
            return;
        }

        // Remove from local subscriptions
        instrumentKeys.forEach(key => {
            this.subscriptions.delete(key);
        });

        // If connected, send unsubscription message
        if (this.connected && this.socket) {
            const unsubRequest = {
                guid: 'pyalgo-guid-' + Date.now(),
                method: 'unsub',
                data: {
                    instrumentKeys: instrumentKeys
                }
            };
            this.socket.send(JSON.stringify(unsubRequest));
            console.log('Sent unsubscription for:', instrumentKeys);
        }
    }

    /**
     * Resubscribe to all instrument keys in the subscriptions set
     * Used after reconnecting
     */
    resubscribe() {
        if (!this.connected || !this.socket || !this.subscriptions.size) {
            return;
        }

        const instrumentKeys = Array.from(this.subscriptions);
        this.sendSubscription(instrumentKeys);
    }

    /**
     * Send a subscription message to the WebSocket
     * @param {Array} instrumentKeys - Array of instrument keys to subscribe to
     */
    sendSubscription(instrumentKeys) {
        if (!this.connected || !this.socket) {
            console.log('Cannot subscribe, WebSocket not connected. Will subscribe on connect.');
            return;
        }

        const subRequest = {
            guid: 'pyalgo-guid-' + Date.now(),
            method: 'sub',
            data: {
                instrumentKeys: instrumentKeys
            }
        };
        this.socket.send(JSON.stringify(subRequest));
        console.log('Sent subscription for:', instrumentKeys);
    }

    /**
     * Handle a market data message from the WebSocket
     * @param {Object} feedResponse - The decoded protobuf message
     */
    handleMarketData(feedResponse) {
        // Process the market data and notify subscribers
        this.messageHandlers.forEach(handler => {
            try {
                handler(feedResponse);
            } catch (e) {
                console.error('Error in market data handler:', e);
            }
        });
    }

    /**
     * Handle a control message from the WebSocket (JSON)
     * @param {Object} message - The parsed JSON message
     */
    handleControlMessage(message) {
        console.log('Received control message:', message);

        if (message.method === 'ack') {
            this.notifyStatus(`Subscription acknowledged: ${message.data?.instrumentKeys?.length || 0} instruments`);
        } else if (message.method === 'nack') {
            this.notifyError(`Subscription rejected: ${message.data?.message || 'Unknown reason'}`);
        }
    }

    /**
     * Register a handler for market data messages
     * @param {Function} handler - The handler function
     */
    onMarketData(handler) {
        if (typeof handler === 'function') {
            this.messageHandlers.push(handler);
        }
    }

    /**
     * Register a handler for status updates
     * @param {Function} handler - The handler function
     */
    onStatus(handler) {
        if (typeof handler === 'function') {
            this.statusHandlers.push(handler);
        }
    }

    /**
     * Register a handler for error messages
     * @param {Function} handler - The handler function
     */
    onError(handler) {
        if (typeof handler === 'function') {
            this.errorHandlers.push(handler);
        }
    }

    /**
     * Notify all status handlers of a status update
     * @param {string} status - The status message
     */
    notifyStatus(status) {
        this.statusHandlers.forEach(handler => {
            try {
                handler(status);
            } catch (e) {
                console.error('Error in status handler:', e);
            }
        });
    }

    /**
     * Notify all error handlers of an error
     * @param {string} error - The error message
     */
    notifyError(error) {
        this.errorHandlers.forEach(handler => {
            try {
                handler(error);
            } catch (e) {
                console.error('Error in error handler:', e);
            }
        });
    }

    /**
     * Extract LTPC (Last Traded Price & Change) data from the market data feed response
     * @param {Object} feedResponse - The decoded protobuf message
     * @returns {Object} - Object with instrument_key as key and LTPC data as value
     */
    extractLtpcFromFeed(feedResponse) {
        if (!feedResponse || !feedResponse.feeds) {
            return {};
        }

        const ltpcData = {};

        try {
            for (const [instrumentKey, feedData] of Object.entries(feedResponse.feeds)) {
                if (feedData.ff && feedData.ff.marketFF && feedData.ff.marketFF.ltpc) {
                    const ltpc = feedData.ff.marketFF.ltpc;
                    ltpcData[instrumentKey] = {
                        ltp: ltpc.ltp,                     // Last traded price
                        change: ltpc.ch,                   // Change from previous close
                        percentage_change: ltpc.chp,       // Change percentage
                        close_price: ltpc.cp,              // Close price (previous day)
                        last_trade_time: ltpc.ltt,         // Last trade time (timestamp)
                        volume: ltpc.v,                    // Volume (if available)
                        atp: ltpc.atp                      // Average traded price (if available)
                    };
                }
            }
            return ltpcData;
        } catch (e) {
            console.error('Error extracting LTPC data from market feed:', e);
            return {};
        }
    }
}

// Create a global instance
window.upstoxWs = new UpstoxWebSocket();
