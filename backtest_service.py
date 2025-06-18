# backtest_service.py
from upstox_service import get_historical_data
from token_manager import token_manager
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json
import traceback # Added for more detailed error logging


class BacktestService:
    def __init__(self):
        self.strategies = {
            "moving_average_crossover": self.moving_average_crossover,
            "rsi_strategy": self.rsi_strategy,
            "bollinger_bands": self.bollinger_bands
            # Add more strategies as needed
        }

    def replace_nan_with_none(self, obj):
        """Replace NaN values with None for proper JSON serialization"""
        if isinstance(obj, dict):
            return {k: self.replace_nan_with_none(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self.replace_nan_with_none(item) for item in obj]
        elif isinstance(obj, float) and np.isnan(obj):
            return None
        else:
            return obj

    def run_backtest(self, instrument_key, strategy_name, params, start_date, end_date):
        """Run backtest for a given instrument and strategy"""
        try:
            historical_data = get_historical_data(instrument_key, "1day", start_date, end_date)

            if not historical_data:
                return {"success": False, "message": "Failed to fetch historical data"}

            if historical_data and len(historical_data) > 0:
                print(f"Sample historical data row: {historical_data[0]}")
                print(f"Number of columns in historical data: {len(historical_data[0]) if historical_data[0] else 'None'}")
            
            processed_data = []
            for row in historical_data:
                if len(row) >= 6:
                    processed_data.append(row[:6])
            
            if not processed_data:
                return {"success": False, "message": "No valid historical data found"}
            
            df = pd.DataFrame(processed_data, columns=["timestamp", "open", "high", "low", "close", "volume"])
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df.set_index('timestamp', inplace=True)
            
            if strategy_name in self.strategies:
                try:
                    # Use df.copy() to avoid SettingWithCopyWarning in strategy functions
                    result = self.strategies[strategy_name](df.copy(), params) 
                    if result is None:
                        return {"success": False, "message": f"Strategy {strategy_name} returned None"}
                    
                    result = self.replace_nan_with_none(result)
                    # Use df.copy() here as well for calculate_metrics
                    metrics = self.calculate_metrics(df.copy(), result) 
                    
                    if isinstance(metrics, dict):
                        metrics = self.replace_nan_with_none(metrics) # Ensure metrics are also cleaned
                    
                    return {
                        "success": True,
                        "data": result,
                        "metrics": metrics
                    }
                except Exception as strategy_error:
                    print(f"Error in strategy {strategy_name}: {strategy_error}")
                    traceback.print_exc()
                    return {"success": False, "message": f"Strategy failed: {str(strategy_error)}"}
            else:
                return {"success": False, "message": f"Strategy {strategy_name} not found"}
        except Exception as e:
            print(f"Error in run_backtest: {e}")
            traceback.print_exc()
            return {"success": False, "message": f"Backtest failed: {str(e)}"}

    def moving_average_crossover(self, df, params):
        """Moving Average Crossover strategy implementation"""
        short_window = params.get("short_window", 20)
        long_window = params.get("long_window", 50)

        df['short_ma'] = df['close'].rolling(window=short_window).mean()
        df['long_ma'] = df['close'].rolling(window=long_window).mean()
        
        df['signal'] = 0
        # Ensure index is valid for slicing before attempting to use .loc
        if len(df) > short_window:
             df.loc[df.index[short_window:], 'signal'] = np.where(
                df['short_ma'].iloc[short_window:] > df['long_ma'].iloc[short_window:], 1, 0
            )
        df['position'] = df['signal'].diff()

        buy_signals = df[df['position'] == 1].index.tolist()
        sell_signals = df[df['position'] == -1].index.tolist()

        return {
            "candles": self.replace_nan_with_none(df.reset_index().to_dict('records')),
            "indicators": {
                "short_ma": self.replace_nan_with_none(df['short_ma'].dropna().reset_index().to_dict('records')),
                "long_ma": self.replace_nan_with_none(df['long_ma'].dropna().reset_index().to_dict('records'))
            },
            "signals": {
                "buy": [{"timestamp": str(timestamp), "price": df.loc[timestamp, 'close']}
                        for timestamp in buy_signals],
                "sell": [{"timestamp": str(timestamp), "price": df.loc[timestamp, 'close']}
                         for timestamp in sell_signals]
            }
        }

    def rsi_strategy(self, df, params):
        """RSI strategy implementation"""
        rsi_period = params.get("rsi_period", 14)
        overbought = params.get("overbought", 70)
        oversold = params.get("oversold", 30)

        delta = df['close'].diff()
        gain = delta.where(delta > 0, 0.0) # Initialize with float
        loss = -delta.where(delta < 0, 0.0) # Initialize with float
        
        # Ensure enough data for rolling mean
        if len(df) > rsi_period:
            avg_gain = gain.rolling(window=rsi_period, min_periods=1).mean()
            avg_loss = loss.rolling(window=rsi_period, min_periods=1).mean()
        else:
            avg_gain = pd.Series(np.nan, index=df.index) # or some default
            avg_loss = pd.Series(np.nan, index=df.index)


        rs = np.where(avg_loss != 0, avg_gain / avg_loss, 100) 
        df['rsi'] = 100 - (100 / (1 + rs))
        
        df['signal'] = 0
        df.loc[df['rsi'] < oversold, 'signal'] = 1 # Buy when oversold
        # Sell when overbought, but only if already in a buy position (signal was 1)
        df.loc[(df['rsi'] > overbought) & (df['signal'].shift(1) == 1) , 'signal'] = 0 

        df['position'] = df['signal'].diff()

        buy_signals = df[df['position'] == 1].index.tolist()
        sell_signals = df[df['position'] == -1].index.tolist() # position becomes -1 when signal changes from 1 to 0

        return {
            "candles": self.replace_nan_with_none(df.reset_index().to_dict('records')),
            "indicators": {
                "rsi": self.replace_nan_with_none(df['rsi'].dropna().reset_index().to_dict('records'))
            },
            "signals": {
                "buy": [{"timestamp": str(timestamp), "price": df.loc[timestamp, 'close']}
                        for timestamp in buy_signals],
                "sell": [{"timestamp": str(timestamp), "price": df.loc[timestamp, 'close']}
                         for timestamp in sell_signals]
            }
        }
        
    def bollinger_bands(self, df, params):
        """Bollinger Bands strategy implementation"""
        window = params.get("window", 20)
        num_std = params.get("num_std", 2)
        
        df['middle_band'] = df['close'].rolling(window=window).mean()
        std = df['close'].rolling(window=window).std()
        df['upper_band'] = df['middle_band'] + (std * num_std)
        df['lower_band'] = df['middle_band'] - (std * num_std)
        
        df['signal'] = 0
        # Buy when price crosses below lower band
        df.loc[df['close'] < df['lower_band'], 'signal'] = 1
        # Sell when price crosses above middle band, but only if already in a buy position
        df.loc[(df['close'] > df['middle_band']) & (df['signal'].shift(1) == 1), 'signal'] = 0
        
        df['position'] = df['signal'].diff()
        
        buy_signals = df[df['position'] == 1].index.tolist()
        sell_signals = df[df['position'] == -1].index.tolist()
        
        return {
            "candles": self.replace_nan_with_none(df.reset_index().to_dict('records')),
            "indicators": {
                "middle_band": self.replace_nan_with_none(df['middle_band'].dropna().reset_index().to_dict('records')),
                "upper_band": self.replace_nan_with_none(df['upper_band'].dropna().reset_index().to_dict('records')),
                "lower_band": self.replace_nan_with_none(df['lower_band'].dropna().reset_index().to_dict('records'))
            },
            "signals": {
                "buy": [{"timestamp": str(timestamp), "price": df.loc[timestamp, 'close']}
                        for timestamp in buy_signals],
                "sell": [{"timestamp": str(timestamp), "price": df.loc[timestamp, 'close']}
                         for timestamp in sell_signals]
            }
        }

    def calculate_metrics(self, df, result):
        """Calculate backtest performance metrics"""
        try:
            if not result or "signals" not in result:
                print("Error: Invalid result structure in calculate_metrics")
                return {"error": "Invalid result structure", "total_trades": 0, "win_rate": 0, "avg_profit": 0, "avg_loss": 0, "max_profit": 0, "max_loss": 0, "net_profit": 0, "trades": []}
            
            signals = result.get("signals", {}) # Use .get for safety
            if not isinstance(signals, dict) or "buy" not in signals or "sell" not in signals:
                print("Error: Missing buy/sell signals in result for calculate_metrics")
                return {"error": "Missing buy/sell signals", "total_trades": 0, "win_rate": 0, "avg_profit": 0, "avg_loss": 0, "max_profit": 0, "max_loss": 0, "net_profit": 0, "trades": []}

            buy_signals_data = signals.get("buy", [])
            sell_signals_data = signals.get("sell", [])

            if not isinstance(buy_signals_data, list) or not isinstance(sell_signals_data, list):
                 print("Error: Buy/sell signals are not lists in calculate_metrics")
                 return {"error": "Buy/sell signals are not lists", "total_trades": 0, "win_rate": 0, "avg_profit": 0, "avg_loss": 0, "max_profit": 0, "max_loss": 0, "net_profit": 0, "trades": []}

            buy_signals_dates = [datetime.fromisoformat(signal["timestamp"]) for signal in buy_signals_data if signal and "timestamp" in signal]
            sell_signals_dates = [datetime.fromisoformat(signal["timestamp"]) for signal in sell_signals_data if signal and "timestamp" in signal]
            
            trades = []
            position_open = False
            entry_price = 0.0 # Initialize as float
            entry_date = None

            if not isinstance(df.index, pd.DatetimeIndex):
                df.index = pd.to_datetime(df.index)

            # Ensure df.index is timezone-naive for comparison with naive signal dates
            if df.index.tz is not None:
                df.index = df.index.tz_localize(None)

            # Sort signals to process them chronologically
            all_signal_dates = sorted(list(set(buy_signals_dates + sell_signals_dates)))

            for date_signal in all_signal_dates:
                # Ensure date is timezone-naive for comparison
                current_date_naive = date_signal.replace(tzinfo=None) if date_signal.tzinfo else date_signal
                
                # Find the corresponding row in df. Use asof for robustness if exact match isn't found.
                if current_date_naive not in df.index:
                    # Try to find the closest available date if exact match is missing
                    closest_date = df.index.asof(current_date_naive)
                    if pd.isna(closest_date): # No suitable date found
                        print(f"Warning: Signal date {current_date_naive} not found in DataFrame index. Skipping.")
                        continue
                    row_data = df.loc[closest_date]
                else:
                    row_data = df.loc[current_date_naive]


                if current_date_naive in buy_signals_dates and not position_open:
                    entry_price = row_data['close']
                    entry_date = current_date_naive
                    position_open = True
                    # print(f"Trade Opened: {entry_date} at {entry_price}")

                elif current_date_naive in sell_signals_dates and position_open:
                    exit_price = row_data['close']
                    if entry_price == 0: # Should not happen if logic is correct
                        profit_pct = 0.0
                        print(f"Warning: Entry price was zero for trade ending {current_date_naive}")
                    else:
                        profit_pct = ((exit_price / entry_price) - 1) * 100
                    
                    trades.append({
                        "entry_date": str(entry_date),
                        "exit_date": str(current_date_naive),
                        "entry_price": entry_price,
                        "exit_price": exit_price,
                        "profit_pct": profit_pct
                    })
                    # print(f"Trade Closed: {current_date_naive} at {exit_price}, Profit: {profit_pct:.2f}%")
                    position_open = False 
            
            if not trades:
                return {"total_trades": 0, "win_rate": 0, "avg_profit": 0, "avg_loss": 0, "max_profit": 0, "max_loss": 0, "net_profit": 0, "trades": []}

            profit_trades = [t for t in trades if t["profit_pct"] > 0]
            loss_trades = [t for t in trades if t["profit_pct"] <= 0] # Includes zero profit trades as non-winning

            return {
                "total_trades": len(trades),
                "win_rate": len(profit_trades) / len(trades) if trades else 0,
                "avg_profit": sum(t["profit_pct"] for t in profit_trades) / len(profit_trades) if profit_trades else 0,
                "avg_loss": sum(t["profit_pct"] for t in loss_trades) / len(loss_trades) if loss_trades else 0, # avg_loss will be negative or zero
                "max_profit": max(t["profit_pct"] for t in trades) if trades else 0,
                "max_loss": min(t["profit_pct"] for t in trades) if trades else 0, # max_loss will be negative or zero
                "net_profit": sum(t["profit_pct"] for t in trades),
                "trades": trades
            }
        except Exception as e:
            print(f"Error in calculate_metrics: {e}")
            traceback.print_exc()
            return {"error": str(e), "total_trades": 0, "win_rate": 0, "avg_profit": 0, "avg_loss": 0, "max_profit": 0, "max_loss": 0, "net_profit": 0, "trades": []}