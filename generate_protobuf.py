import os
import subprocess
import sys
import requests

PROTO_URL = "https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto" # Updated URL
PROTO_FILENAME = "MarketDataFeed.proto"
GENERATED_FILENAME = "MarketDataFeed_pb2.py"
WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
PROTO_FILE_PATH = os.path.join(WORKSPACE_DIR, PROTO_FILENAME)
GENERATED_FILE_PATH = os.path.join(WORKSPACE_DIR, GENERATED_FILENAME)

def install_packages():
    """Installs protobuf and grpcio-tools if not already satisfied."""
    packages = ["protobuf", "grpcio-tools"]
    try:
        print(f"Checking/installing required packages: {', '.join(packages)}...")
        # Ensure pip is available and use it from the current Python environment
        subprocess.check_call([sys.executable, "-m", "pip", "install"] + packages)
        print("Packages checked/installed successfully.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error installing packages: {e}")
        print("Please ensure pip is installed and working correctly.")
        return False
    except FileNotFoundError:
        print("Error: sys.executable not found. Is Python installed correctly?")
        return False

def download_proto_file():
    """Downloads the .proto file from the Upstox repository."""
    try:
        print(f"Downloading {PROTO_FILENAME} from {PROTO_URL}...")
        response = requests.get(PROTO_URL, timeout=30)
        response.raise_for_status()  # Raise an exception for HTTP errors
        with open(PROTO_FILE_PATH, 'wb') as f:
            f.write(response.content)
        print(f"{PROTO_FILENAME} downloaded successfully to {PROTO_FILE_PATH}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"Error downloading .proto file: {e}")
        return False

def generate_python_classes():
    """Generates Python classes from the .proto file."""
    if not os.path.exists(PROTO_FILE_PATH):
        print(f"Error: {PROTO_FILE_PATH} not found. Please download it first.")
        return False

    try:
        print(f"Generating Python classes from {PROTO_FILENAME}...")
        # Ensure we are in the directory where the .proto file is, or specify paths correctly
        # The -I. means "look for imports in the current directory"
        # --python_out=. means "output python files to the current directory"
        # We'll run this from the WORKSPACE_DIR
        protoc_command = [
            sys.executable,
            "-m", "grpc_tools.protoc",
            f"-I{WORKSPACE_DIR}",  # Search for .proto file in WORKSPACE_DIR
            f"--python_out={WORKSPACE_DIR}", # Output to WORKSPACE_DIR
            PROTO_FILE_PATH # The .proto file to compile
        ]
        print(f"Running command: {' '.join(protoc_command)}")
        subprocess.check_call(protoc_command, cwd=WORKSPACE_DIR) # Run with CWD as WORKSPACE_DIR

        if os.path.exists(GENERATED_FILE_PATH):
            print(f"{GENERATED_FILENAME} generated successfully at {GENERATED_FILE_PATH}")
            return True
        else:
            print(f"Error: {GENERATED_FILENAME} was not generated.")
            return False
    except subprocess.CalledProcessError as e:
        print(f"Error generating Python classes: {e}")
        if e.stderr:
            print(f"Compiler Stderr: {e.stderr.decode()}")
        if e.stdout:
            print(f"Compiler Stdout: {e.stdout.decode()}")
        return False
    except FileNotFoundError:
        print("Error: grpc_tools.protoc or python not found. Ensure grpcio-tools is installed and Python is in PATH.")
        return False

if __name__ == "__main__":
    print("Starting Protobuf class generation process...")

    if not install_packages():
        print("Halting due to package installation failure.")
        sys.exit(1)

    if not download_proto_file():
        print("Halting due to .proto file download failure.")
        sys.exit(1)

    if generate_python_classes():
        print("Protobuf class generation completed successfully.")
    else:
        print("Protobuf class generation failed.")
        sys.exit(1)

