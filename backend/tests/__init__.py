import os

# Exercise the backend fallback instead of inheriting a caller-specific CORS policy.
os.environ.pop("ALLOWED_ORIGINS", None)
