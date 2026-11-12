"""The one exception every stage of the driver raises."""


class DriverError(Exception):
    """A problem with the user's input, reported before anything is compiled.

    The message is written for the user: it names the parameter, the example
    part, or the type that caused it, and says what was expected.
    """
