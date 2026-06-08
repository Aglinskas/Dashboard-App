#!/bin/bash
# Startup script for AURA Productivity Dashboard

echo "============================================="
echo "Initializing AURA Productivity Dashboard..."
echo "============================================="

# Start the python server in the background
python3 server.py &
SERVER_PID=$!

# Wait a moment for python to parse data and bind to port 8000
sleep 1.5

# Detect OS and open browser
echo "Opening dashboard in your web browser..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    open "http://localhost:8000"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open "http://localhost:8000"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    start "http://localhost:8000"
else
    echo "============================================="
    echo "Dashboard ready! Please visit:"
    echo "http://localhost:8000"
    echo "============================================="
fi

# Clean exit: stop python server when shell script is terminated (Ctrl+C)
trap "echo -e '\nStopping server...'; kill $SERVER_PID" EXIT
wait $SERVER_PID
