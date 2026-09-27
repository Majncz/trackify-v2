-- API tokens are now stored as SHA-256 hex of the raw token (clients keep the raw value).
UPDATE "trackify_api_token"
SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
