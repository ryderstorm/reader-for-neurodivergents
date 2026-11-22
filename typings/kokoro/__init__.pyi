from collections.abc import Iterable
from typing import Any

class KModel:
    def to(self, device: str) -> KModel: ...
    def eval(self) -> KModel: ...

class KPipeline:
    def __init__(
        self,
        lang_code: str,
        model: KModel | None = None,
        repo_id: str | None = None,
    ) -> None: ...
    def __call__(
        self,
        text: str,
        voice: str = ...,
        speed: float = ...,
        split_pattern: str = ...,
    ) -> Iterable[Any]: ...
