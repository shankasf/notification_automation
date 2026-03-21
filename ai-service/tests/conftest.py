import sys
from pathlib import Path

# Add ai-service root to Python path so guardrails, logging_config, etc. are importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
