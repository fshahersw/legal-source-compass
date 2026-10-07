"""A hard wall-clock deadline for one blocking call, so a hung connection cannot stall a paced capture for hours.

signal.setitimer raises HardDeadline (a BaseException, so a fetcher's own `except Exception` retry loops cannot swallow it) in the
main thread when the deadline passes. The crawl delay is separate and unchanged: this only ends a request that is not finishing.
"""
import signal


class HardDeadline(BaseException):
    pass


def _raise(signum, frame):
    raise HardDeadline()


def run_with_deadline(seconds, fn, *args, **kwargs):
    previous = signal.signal(signal.SIGALRM, _raise)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        return fn(*args, **kwargs)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
