#!/usr/bin/env bash

# Utility function to convert from JSON responses to Open API Spec 3.
# Sample usage: bash ./scripts/json-to-schema.sh /Users/manu/workspace/sentry-api-schema/tests/teams/teams-by-slug-get-test.json

# Always puts the output in the same folder as the json being converted.
# All this does is infer the type from the json.
# Caveats:
# * Doesn't add enum types
# * Doesn't add scopes

docker build -t openapispec3-converter scripts

a=$1
xpath=${a%/*}
filename=$(basename $a)

docker run -v $xpath:/usr/src/output -t openapispec3-converter /usr/src/output/$filename /usr/src/output/output.json
