"""Offline machine-OCR engine for the PDF full-text extractor (surya 0.17.0, models from the local datalab cache).

Guarantees: nothing is downloaded. The model directories are checked against their manifests before anything is imported; if one is
missing the engine refuses to start (ModelMissing) so the operator is told instead of a silent download. Outbound sockets are
blocked in the process after the check. Device: CUDA when torch sees it, otherwise CPU (fp32).
"""
from __future__ import annotations

import os
import re
import socket

MODEL_CACHE = os.environ.get("SURYA_MODEL_CACHE") or os.path.join(os.environ.get("LOCALAPPDATA", ""), "datalab", "datalab", "Cache", "models")
RECOGNITION = "text_recognition/2025_09_23"
DETECTION = "text_detection/2025_05_07"
_TAGS = re.compile(r"</?(?:b|i|u|em|strong|sub|sup|math|span|mark|small|a|br)\b[^>]*>", re.I)


class ModelMissing(RuntimeError):
    pass


def block_network() -> None:
    """After this call every non-loopback connection attempt in the process raises OSError."""
    real_connect = socket.socket.connect

    def guarded(self, address, *args, **kwargs):
        host = address[0] if isinstance(address, tuple) else str(address)
        if host in ("127.0.0.1", "::1", "localhost"):
            return real_connect(self, address, *args, **kwargs)
        raise OSError("network disabled in the OCR process: " + str(host))

    socket.socket.connect = guarded  # type: ignore[assignment]

    def no_resolve(*args, **kwargs):
        raise OSError("name resolution disabled in the OCR process")

    socket.getaddrinfo = no_resolve  # type: ignore[assignment]


def check_models(cache: str = MODEL_CACHE) -> None:
    import json

    for checkpoint in (RECOGNITION, DETECTION):
        folder = os.path.join(cache, *checkpoint.split("/"))
        manifest = os.path.join(folder, "manifest.json")
        if not os.path.exists(manifest):
            raise ModelMissing("MODEL_MISSING " + checkpoint + " (no manifest.json)")
        with open(manifest, encoding="utf-8") as fh:
            files = json.load(fh)["files"]
        for name in files:
            if not os.path.exists(os.path.join(folder, name)):
                raise ModelMissing("MODEL_MISSING " + checkpoint + " (" + name + ")")


def clean_line(text: str) -> str:
    text = text.replace("<br>", "\n").replace("<br/>", "\n")
    return _TAGS.sub("", text)


class SuryaEngine:
    """recognize(low_images, high_images) -> [{'text','confidence','lines','low_conf_lines'}] for each page."""

    def __init__(self, threads: int = 12, lower_priority: bool = True):
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
        check_models()
        block_network()
        import torch

        torch.set_num_threads(threads)
        from surya.common.surya.schema import TaskNames
        from surya.detection import DetectionPredictor
        from surya.foundation import FoundationPredictor
        from surya.recognition import RecognitionPredictor
        from surya.settings import settings

        self._tasks = TaskNames
        self.device = settings.TORCH_DEVICE_MODEL
        self.foundation = FoundationPredictor()
        self.detector = DetectionPredictor()
        self.recognizer = RecognitionPredictor(self.foundation)
        self.label = "surya-ocr 0.17.0 (" + RECOGNITION + ", " + DETECTION + "; " + str(self.device) + (" fp32" if self.device == "cpu" else "") + ")"
        if lower_priority:
            try:
                import psutil

                psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
            except Exception:  # noqa: BLE001
                pass

    def recognize(self, low_images, high_images):
        n = len(low_images)
        results = self.recognizer(low_images, task_names=[self._tasks.ocr_with_boxes] * n, det_predictor=self.detector,
                                  highres_images=high_images, math_mode=False, sort_lines=True)
        out = []
        for r in results:
            lines = [(clean_line(line.text), float(line.confidence or 0.0)) for line in r.text_lines]
            lines = [(t, c) for t, c in lines if t.strip()]
            total = sum(max(len(t), 1) for t, _ in lines)
            conf = sum(c * max(len(t), 1) for t, c in lines) / total if total else 0.0
            out.append({"text": "\n".join(t for t, _ in lines), "confidence": conf, "lines": len(lines),
                        "low_conf_lines": sum(1 for _, c in lines if c < 0.6)})
        return out
