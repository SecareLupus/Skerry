#!/bin/bash
# Helper to generate Synapse signing key if missing

SYNC_DIR="./docker/synapse"
SERVER_NAME="hub-localhost"
KEY_FILE="${SYNC_DIR}/${SERVER_NAME}.signing.key"

if [ ! -f "$KEY_FILE" ]; then
    echo "Generating missing Synapse signing key..."
    docker run -it --rm \
        -v "$(pwd)/${SYNC_DIR}:/data" \
        -e SYNAPSE_SERVER_NAME=${SERVER_NAME} \
        -e SYNAPSE_REPORT_STATS=no \
        matrixdotorg/synapse:latest generate
    echo "Key generated at $KEY_FILE"
else
    echo "Synapse signing key already exists."
fi
