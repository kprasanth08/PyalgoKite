# backtest_service.py
from upstox_service import get_historical_data
from token_manager import token_manager
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json


class BacktestService:
    def __init__(self):
        self.strategies = {
            "moving_average_crossover": self.moving_average_crossover,
            "rsi_strategy": self.rsi_strategy,
            "bollinger_bands": self.bollinger_bands
            # Add more strategies as needed
        }

    def run_backtest(self, instrument_key, strategy_name, params, start_date, end_date):
        """Run backtest for a given instrument and strategy"""
        # Get historical data from Upstox
        historical_data = get_historical_data(instrument_key, "1day", start_date, end_date)

        if not historical_data:
            return {"success": False, "message": "Failed to fetch historical data"}

        # Convert to pandas DataFrame for easier manipulation
        df = pd.DataFrame(historical_data, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df.set_index('timestamp', inplace=True)

        # Run the selected strategy
        if strategy_name in self.strategies:
            result = self.strategies[strategy_name](df, params)
            return {
                "success": True,
                "data": result,
                "metrics": self.calculate_metrics(df, result)
            }
        else:
            return {"success": False, "message": f"Strategy {strategy_name} not found"}

    def moving_average_crossover(self, df, params):
        """Moving Average Crossover strategy implementation"""
        short_window = params.get("short_window", 20)
        long_window = params.get("long_window", 50)

        # Calculate moving averages
        df['short_ma'] = df['close'].rolling(window=short_window).mean()
        df['long_ma'] = df['close'].rolling(window=long_window).mean()

        # Generate signals
        df['signal'] = 0
        df['signal'][short_window:] = np.where(
            df['short_ma'][short_window:] > df['long_ma'][short_window:], 1, 0)
        df['position'] = df['signal'].diff()

        # Create buy/sell signals for charting
        buy_signals = df[df['position'] == 1].index.tolist()
        sell_signals = df[df['position'] == -1].index.tolist()

        return {
            "candles": df.reset_index().to_dict('records'),
            "indicators": {
                "short_ma": df['short_ma'].dropna().reset_index().to_dict('records'),
                "long_ma": df['long_ma'].dropna().reset_index().to_dict('records')
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

        # Calculate RSI
        delta = df['close'].diff()
        gain = delta.where(delta > 0, 0)
        loss = -delta.where(delta < 0, 0)

        avg_gain = gain.rolling(window=rsi_period).mean()
        avg_loss = loss.rolling(window=rsi_period).mean()

        rs = avg_gain / avg_loss
        df['rsi'] = 100 - (100 / (1 + rs))

        # Generate signals
        df['signal'] = 0
        df['signal'] = np.where(df['rsi'] < oversold, 1, 0)
        df['position'] = df['signal'].diff()

        # Create buy/sell signals for charting
        buy_signals = df[df['position'] == 1].index.tolist()
        sell_signals = df[df['rsi'] > overbought].index.tolist()

        return {
            "candles": df.reset_index().to_dict('records'),
            "indicators": {
                "rsi": df['rsi'].dropna().reset_index().to_dict('records')
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
        # Implementation details...
        pass

    def calculate_metrics(self, df, result):
        """Calculate backtest performance metrics"""
        # Extract buy/sell signals
        buy_signals = [datetime.fromisoformat(signal["timestamp"]) for signal in result["signals"]["buy"]]
        sell_signals = [datetime.fromisoformat(signal["timestamp"]) for signal in result["signals"]["sell"]]

        # Pair buy/sell signals and calculate returns
        trades = []
        position_open = False
        entry_price = 0
        entry_date = None

        for index, row in df.iterrows():
            date = index

            if date in buy_signals and not position_open:
                entry_price = row['close']
                entry_date = date
                position_open = True

            elif date in sell_signals and position_open:
                exit_price = row['close']
                profit_pct = ((exit_price / entry_price) - 1) * 100
                trades.append({
                    "entry_date": str(entry_date),
                    "exit_date": str(date),
                    "entry_price": entry_price,
                    "exit_price": exit_price,
                    "profit_pct": profit_pct
                })
                position_open = False

        # Calculate metrics
        if not trades:
            return {"total_trades": 0}

        profit_trades = [t for t in trades if t["profit_pct"] > 0]
        loss_trades = [t for t in trades if t["profit_pct"] <= 0]

        return {
            "total_trades": len(trades),
            "win_rate": len(profit_trades) / len(trades) if trades else 0,
            "avg_profit": sum(t["profit_pct"] for t in profit_trades) / len(profit_trades) if profit_trades else 0,
            "avg_loss": sum(t["profit_pct"] for t in loss_trades) / len(loss_trades) if loss_trades else 0,
            "max_profit": max([t["profit_pct"] for t in trades]) if trades else 0,
            "max_loss": min([t["profit_pct"] for t in trades]) if trades else 0,
            "net_profit": sum(t["profit_pct"] for t in trades),
            "trades": trades
        }