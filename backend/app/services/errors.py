class UpstreamServiceError(Exception):
    error_code = "UPSTREAM_API_ERROR"


class UpstreamAuthError(UpstreamServiceError):
    error_code = "UPSTREAM_AUTH_ERROR"


class UpstreamRateLimitError(UpstreamServiceError):
    error_code = "UPSTREAM_RATE_LIMIT"


class UpstreamTimeoutError(UpstreamServiceError):
    error_code = "UPSTREAM_TIMEOUT"


class UpstreamBadResponseError(UpstreamServiceError):
    error_code = "UPSTREAM_BAD_RESPONSE"
