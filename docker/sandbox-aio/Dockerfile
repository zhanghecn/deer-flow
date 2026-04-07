ARG BASE_IMAGE=enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest
FROM ${BASE_IMAGE}

# The sandbox image must carry document-generation dependencies up front.
# Lead-agent runs should not spend time or rely on ad-hoc self-install for
# MiniMax PDF/DOCX skills or the generic Python document-generation path.
# Use .NET 9 here because copied DOCX skills ship `.slnx` solution files, and
# the runtime must execute them as-authored instead of depending on per-skill
# rewrites or manual fallback commands inside the agent loop.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap \
        ca-certificates \
        curl \
        fonts-noto-cjk \
        pandoc \
    && curl -fsSL https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb \
    && dpkg -i /tmp/packages-microsoft-prod.deb \
    && rm -f /tmp/packages-microsoft-prod.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends dotnet-sdk-9.0 \
    && python3 -m pip install --no-cache-dir --break-system-packages \
        pypdf \
        python-docx \
        reportlab \
    && rm -rf /var/lib/apt/lists/*
