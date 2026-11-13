"""Run on the API machine: python3 scripts/configure_spark.py --url http://SPARK_IP:11434 --model MODEL"""
import argparse
from pathlib import Path
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description="Configure the existing Ollama adapter without overwriting other settings")
    parser.add_argument("--url", required=True, help="Reachable Ollama server URL on Spark")
    parser.add_argument("--model", required=True, help="Exact installed vision-capable model name")
    args = parser.parse_args()
    url = urlparse(args.url)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
        parser.error("Use an HTTP(S) server URL without credentials, query or fragment")
    if any(character in args.model + args.url for character in ["\n", "\r", '"', "'"]) or not args.model.strip():
        parser.error("URL and model must be single-line values without quotes")
    path = Path(__file__).resolve().parents[1] / "backend" / ".env"
    changes = {"OLLAMA_BASE_URL": args.url.rstrip("/"), "OLLAMA_MODEL": args.model}
    lines = path.read_text().splitlines() if path.exists() else []
    output = []
    for line in lines:
        key = line.partition("=")[0].strip()
        if key in changes:
            output.append(f'{key}="{changes.pop(key)}"')
        else:
            output.append(line)
    output.extend(f'{key}="{value}"' for key, value in changes.items())
    path.write_text("\n".join(output) + "\n")
    print("Updated the model configuration. Restart the backend, then check /health/model and upload a synthetic letter.")


if __name__ == "__main__":
    main()
