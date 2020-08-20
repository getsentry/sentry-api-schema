setup:
	# TODO(manu): how to not install this globally?
	npm install -g swagger-ui-watcher
	npm install -g openapi-examples-validator

serve:
	swagger-ui-watcher ./openapi.json

test:
	# Test examples in the docs. We don't want to allow any fields in the examples
	# that do not exist in the schema. Hence the --no-additional-properties option
	openapi-examples-validator ./openapi.json --no-additional-properties
