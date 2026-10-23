FROM python:3.12-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend/src

WORKDIR /app/backend
COPY locks ./locks
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r locks/build.lock -r locks/runtime.lock
COPY pyproject.toml ./
COPY src ./src
COPY data-inventory.json ./data-inventory.json
RUN pip install --no-cache-dir --no-deps --no-build-isolation . && pip check && \
    addgroup --system orbis && adduser --system --ingroup orbis --home /nonexistent --no-create-home orbis

USER orbis
EXPOSE 8000
CMD ["uvicorn", "astro_system.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]

FROM runtime AS orbital
USER root
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r locks/runtime.lock -r locks/orbital.lock && pip check
USER orbis

# Inherits the exact orbital numerical dependencies; pytest adds no new model.
FROM orbital AS science-tests
USER root
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r locks/runtime.lock -r locks/tests.lock && pip check
COPY tests ./tests
COPY validation ./validation
COPY tools ./tools
USER orbis
CMD ["python", "tools/run_gates.py", "--environment", "linux-cp312"]
