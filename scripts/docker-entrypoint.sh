#!/bin/sh
set -e

# Ensure data directory exists
mkdir -p /nova-corps/instances/default

exec "$@"
