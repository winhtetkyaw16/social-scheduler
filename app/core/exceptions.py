"""Domain exceptions raised by provider integrations and application services."""


class SocialSchedulerError(Exception):
    """Base exception for expected application-level failures."""


class ProviderConfigurationError(SocialSchedulerError):
    """A provider cannot process a request with the current configuration."""

    pass
