FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY app/requirements-runtime.txt /tmp/requirements-runtime.txt
RUN python -m pip install -r /tmp/requirements-runtime.txt \
    --extra-index-url https://www.piwheels.org/simple

COPY app /app
WORKDIR /app
VOLUME ["/data"]

EXPOSE 8000/tcp

LABEL version="0.1.0"

ARG IMAGE_NAME=rov-trail-widget

LABEL permissions='{\
  "ExposedPorts": {\
    "8000/tcp": {}\
  },\
  "HostConfig": {\
    "Binds": ["/usr/blueos/extensions/$IMAGE_NAME:/data"],\
    "PortBindings": {\
      "8000/tcp": [{"HostPort": ""}]\
    }\
  }\
}'

ARG AUTHOR
ARG AUTHOR_EMAIL
LABEL authors='[{"name": "$AUTHOR", "email": "$AUTHOR_EMAIL"}]'

ARG MAINTAINER
ARG MAINTAINER_EMAIL
LABEL company='{"about": "", "name": "$MAINTAINER", "email": "$MAINTAINER_EMAIL"}'

LABEL type="tool"

ARG REPO
ARG OWNER
LABEL readme='https://raw.githubusercontent.com/$OWNER/$REPO/{tag}/README.md'
LABEL links='{"source": "https://github.com/$OWNER/$REPO"}'
LABEL requirements="core >= 1.1"

ENTRYPOINT ["litestar", "--app", "main:app", "run", "--host", "0.0.0.0", "--port", "8000"]
