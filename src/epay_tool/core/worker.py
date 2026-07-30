"""Background execution so the UI never blocks during a 100-item batch."""

from __future__ import annotations

from collections.abc import Callable

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Signal


class _Signals(QObject):
    finished = Signal(int)          # product_id
    failed = Signal(int, str)       # product_id, error


class ProductJob(QRunnable):
    """Runs one pipeline step (enrich or publish) for one product."""

    def __init__(self, product_id: int, fn: Callable[[int], None]):
        super().__init__()
        self.product_id = product_id
        self.fn = fn
        self.signals = _Signals()

    def run(self) -> None:
        try:
            self.fn(self.product_id)
            self.signals.finished.emit(self.product_id)
        except Exception as exc:  # pipeline already persists errors; belt & braces
            self.signals.failed.emit(self.product_id, str(exc))


class JobRunner:
    """Bounded thread pool - parallel enrichment without hammering the APIs."""

    def __init__(self, max_threads: int = 4):
        self.pool = QThreadPool()
        self.pool.setMaxThreadCount(max_threads)

    def submit(
        self,
        product_id: int,
        fn: Callable[[int], None],
        on_done: Callable[[int], None] | None = None,
    ) -> None:
        job = ProductJob(product_id, fn)
        if on_done:
            job.signals.finished.connect(on_done)
            job.signals.failed.connect(lambda pid, _err: on_done(pid))
        self.pool.start(job)
