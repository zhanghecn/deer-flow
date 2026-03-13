FROM onlyoffice/documentserver@sha256:53a06109f1f4029a78f913a061e14f01bff023d109024073a13d4416b54d2195

USER root

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*
