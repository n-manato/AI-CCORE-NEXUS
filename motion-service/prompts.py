"""Emotion set + English HY-Motion prompt templates.

SHARED CONSTANT with PC-A: the emotion list here must match the VTuber app. Prompts
are English, < 30 words, describe a short (<= 5 s) in-place, talking-style body
gesture (no walking away -- global motion is discarded downstream).

Tuned for NATURAL CONVERSATION: hands stay in the waist-to-chest "talking box";
NO arms raised overhead, NO hands near/over the face, small symmetric gestures,
subtle weight shift. (Big overhead / face-crossing gestures read as peek-a-boo,
not talking.)
"""
from __future__ import annotations

EMOTIONS = ["neutral", "happy", "sad", "thinking", "surprised", "angry", "shy"]

EMOTION_PROMPTS: dict[str, str] = {
    "neutral":  "a person calmly talking, small relaxed hand gestures kept low near the waist, arms mostly down, subtle weight shift",
    "happy":    "a person cheerfully talking, small upbeat hand gestures at waist and chest height, hands stay low, arms never raised overhead, hands never near the face, slight bounce",
    "sad":      "a person talking quietly, slow small low gestures near the waist, slightly slumped shoulders, hands stay low",
    "thinking": "a person talking thoughtfully, one hand gesturing low near the waist, a small slow nod, calm and contained",
    "surprised":"a person mildly surprised while talking, one small quick hand gesture at chest height, a slight lean back, hands stay below the shoulders",
    "angry":    "a person talking firmly, small sharp emphatic hand gestures at waist and chest height, tense but contained, hands stay low",
    "shy":      "a shy person talking timidly, hands close to the body near the waist, small fidgeting, minimal movement",
}

DEFAULT_DURATION = 4.0  # seconds


def prompt_for(emotion: str) -> str:
    return EMOTION_PROMPTS.get(emotion, EMOTION_PROMPTS["neutral"])
