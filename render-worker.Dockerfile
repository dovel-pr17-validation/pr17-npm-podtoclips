ARG NODE_VERSION=20.20.2
ARG PYTHON_VERSION=3.14.5
ARG NPM_VERSION=11.18.0

FROM node:${NODE_VERSION}-bookworm-slim AS node-runtime

FROM node:${NODE_VERSION}-bookworm-slim AS media-builder

ARG FFMPEG_VERSION=8.1.2
ARG X264_REVISION=b35605ace3ddf7c1a5d67a2eb553f034aef41d55
ARG FREETYPE_VERSION=2.14.3
ARG FONTCONFIG_VERSION=2.18.1
ARG FRIBIDI_VERSION=1.0.16
ARG HARFBUZZ_VERSION=14.2.1
ARG LIBASS_VERSION=0.17.5
ARG DAV1D_VERSION=1.5.3

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git gperf nasm ninja-build pkg-config python3-venv xz-utils \
    libbrotli-dev libbz2-dev libexpat1-dev libpng-dev zlib1g-dev \
    libass-dev libfontconfig1-dev libfreetype6-dev libfribidi-dev \
    libgnutls28-dev libharfbuzz-dev libmp3lame-dev libopus-dev \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/media-build-venv \
  && /opt/media-build-venv/bin/pip install --no-cache-dir meson==1.11.0

ENV PATH=/opt/media-build-venv/bin:${PATH}
ENV PKG_CONFIG_PATH=/opt/easyed-media/lib/x86_64-linux-gnu/pkgconfig:/opt/easyed-media/lib/pkgconfig
ENV LD_LIBRARY_PATH=/opt/easyed-media/lib/x86_64-linux-gnu:/opt/easyed-media/lib

RUN curl -fsSL "https://download.savannah.gnu.org/releases/freetype/freetype-${FREETYPE_VERSION}.tar.xz" -o /tmp/freetype.tar.xz \
  && tar -xJf /tmp/freetype.tar.xz -C /tmp \
  && cd "/tmp/freetype-${FREETYPE_VERSION}" \
  && ./configure --prefix=/opt/easyed-media --enable-shared --disable-static \
  && make -j"$(nproc)" \
  && make install

RUN curl -fsSL "https://github.com/fribidi/fribidi/releases/download/v${FRIBIDI_VERSION}/fribidi-${FRIBIDI_VERSION}.tar.xz" -o /tmp/fribidi.tar.xz \
  && tar -xJf /tmp/fribidi.tar.xz -C /tmp \
  && cd "/tmp/fribidi-${FRIBIDI_VERSION}" \
  && ./configure --prefix=/opt/easyed-media --enable-shared --disable-static \
  && make -j"$(nproc)" \
  && make install

RUN curl -fsSL "https://github.com/harfbuzz/harfbuzz/releases/download/${HARFBUZZ_VERSION}/harfbuzz-${HARFBUZZ_VERSION}.tar.xz" -o /tmp/harfbuzz.tar.xz \
  && tar -xJf /tmp/harfbuzz.tar.xz -C /tmp \
  && meson setup /tmp/harfbuzz-build "/tmp/harfbuzz-${HARFBUZZ_VERSION}" \
    --prefix=/opt/easyed-media --buildtype=release \
    -Dglib=disabled -Dgobject=disabled -Dcairo=disabled -Dchafa=disabled \
    -Dpng=disabled -Dzlib=disabled -Dicu=disabled -Dfreetype=enabled \
    -Dtests=disabled -Ddocs=disabled -Dutilities=disabled -Dgpu=disabled \
  && meson compile -C /tmp/harfbuzz-build \
  && meson install -C /tmp/harfbuzz-build

RUN curl -fsSL "https://gitlab.freedesktop.org/fontconfig/fontconfig/-/archive/${FONTCONFIG_VERSION}/fontconfig-${FONTCONFIG_VERSION}.tar.gz" -o /tmp/fontconfig.tar.gz \
  && tar -xzf /tmp/fontconfig.tar.gz -C /tmp \
  && meson setup /tmp/fontconfig-build "/tmp/fontconfig-${FONTCONFIG_VERSION}" \
    --prefix=/opt/easyed-media --buildtype=release \
    -Ddoc=disabled -Dtests=disabled -Dtools=enabled -Dnls=disabled \
    -Dcache-build=disabled -Dxml-backend=expat \
  && meson compile -C /tmp/fontconfig-build \
  && meson install -C /tmp/fontconfig-build

RUN curl -fsSL "https://github.com/libass/libass/releases/download/${LIBASS_VERSION}/libass-${LIBASS_VERSION}.tar.xz" -o /tmp/libass.tar.xz \
  && tar -xJf /tmp/libass.tar.xz -C /tmp \
  && cd "/tmp/libass-${LIBASS_VERSION}" \
  && ./configure --prefix=/opt/easyed-media --enable-shared --disable-static \
  && make -j"$(nproc)" \
  && make install \
  && grep -Eq '^#define FREETYPE_MAJOR +2$' /opt/easyed-media/include/freetype2/freetype/freetype.h \
  && grep -Eq '^#define FREETYPE_MINOR +14$' /opt/easyed-media/include/freetype2/freetype/freetype.h \
  && grep -Eq '^#define FREETYPE_PATCH +3$' /opt/easyed-media/include/freetype2/freetype/freetype.h \
  && pkg-config --modversion fontconfig | grep -q "^${FONTCONFIG_VERSION}$" \
  && pkg-config --modversion fribidi | grep -q "^${FRIBIDI_VERSION}$" \
  && pkg-config --modversion harfbuzz | grep -q "^${HARFBUZZ_VERSION}$" \
  && pkg-config --modversion libass | grep -q "^${LIBASS_VERSION}$"

RUN curl -fsSL "https://code.videolan.org/videolan/dav1d/-/archive/${DAV1D_VERSION}/dav1d-${DAV1D_VERSION}.tar.gz" -o /tmp/dav1d.tar.gz \
  && tar -xzf /tmp/dav1d.tar.gz -C /tmp \
  && meson setup /tmp/dav1d-build "/tmp/dav1d-${DAV1D_VERSION}" \
    --prefix=/opt/easyed-media --buildtype=release \
    -Denable_tools=false -Denable_tests=false \
  && meson compile -C /tmp/dav1d-build \
  && meson install -C /tmp/dav1d-build \
  && pkg-config --modversion dav1d | grep -q "^${DAV1D_VERSION}$"

RUN git clone https://code.videolan.org/videolan/x264.git /tmp/x264 \
  && cd /tmp/x264 \
  && git checkout "${X264_REVISION}" \
  && ./configure \
    --prefix=/opt/easyed-media \
    --enable-shared \
    --enable-pic \
    --chroma-format=all \
  && make -j"$(nproc)" \
  && make install

RUN curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o /tmp/ffmpeg.tar.xz \
  && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
  && cd "/tmp/ffmpeg-${FFMPEG_VERSION}" \
  && ./configure \
    --prefix=/opt/easyed-media \
    --enable-shared \
    --disable-static \
    --disable-doc \
    --enable-pthreads \
    --enable-version3 \
    --enable-gpl \
    --enable-gnutls \
    --enable-libass \
    --enable-libdav1d \
    --enable-libfontconfig \
    --enable-libfreetype \
    --enable-libharfbuzz \
    --enable-libmp3lame \
    --enable-libopus \
    --enable-libx264 \
    --extra-cflags=-I/opt/easyed-media/include \
    --extra-ldflags="-L/opt/easyed-media/lib/x86_64-linux-gnu -L/opt/easyed-media/lib" \
  && make -j"$(nproc)" \
  && make install \
  && /opt/easyed-media/bin/ffmpeg -version | grep -q "ffmpeg version ${FFMPEG_VERSION}" \
  && /opt/easyed-media/bin/x264 --version | grep -q "x264 0.165.3222" \
  && /opt/easyed-media/bin/ffmpeg -hide_banner -decoders | grep -q 'libdav1d' \
  && printf '[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,Arial,32,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,parity\n' > /tmp/runtime-check.ass \
  && /opt/easyed-media/bin/ffmpeg -hide_banner -loglevel verbose -f lavfi -i color=size=64x64:duration=0.1 -vf subtitles=/tmp/runtime-check.ass -frames:v 1 -f null - 2> /tmp/caption-runtime.log \
  && grep -q "libass source:.*${LIBASS_VERSION}" /tmp/caption-runtime.log \
  && grep -q "FriBidi ${FRIBIDI_VERSION}.*HarfBuzz-ng ${HARFBUZZ_VERSION}" /tmp/caption-runtime.log

FROM python:${PYTHON_VERSION}-slim-bookworm

ARG NODE_VERSION=20.20.2
ARG PYTHON_VERSION=3.14.5
ARG FFMPEG_VERSION=8.1.2
ARG NPM_VERSION=11.18.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates fontconfig fonts-inter fonts-noto-core \
    libass9 libfontconfig1 libfreetype6 libfribidi0 libgnutls30 \
    libharfbuzz0b libmp3lame0 libopus0 libglib2.0-0 libgl1 libegl1 libgles2 libgomp1 \
    libsm6 libx11-6 libxext6 libxrender1 \
  && fc-cache -f \
  && fc-match "Inter" | grep -qi "Inter" \
  && fc-match "Noto Sans Devanagari" | grep -qi "NotoSansDevanagari" \
  && ldconfig -p | grep -q 'libGLESv2.so.2' \
  && mkdir -p /opt/easyed-fonts \
  && find /usr/share/fonts/truetype -type f \( -iname 'Inter*.ttf' -o -iname 'NotoSansDevanagari*.ttf' \) -exec cp '{}' /opt/easyed-fonts/ \; \
  && test "$(find /opt/easyed-fonts -type f | wc -l)" -ge 2 \
  && fc-cache -f /opt/easyed-fonts \
  && rm -rf /var/lib/apt/lists/*

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && npm install --global "npm@${NPM_VERSION}" \
  && npm --version | grep -q "^${NPM_VERSION}$"

COPY --from=media-builder /opt/easyed-media /opt/easyed-media

ENV PATH=/opt/easyed-media/bin:/usr/local/bin:${PATH}
ENV LD_LIBRARY_PATH=/opt/easyed-media/lib/x86_64-linux-gnu:/opt/easyed-media/lib
ENV FFMPEG_PATH=/opt/easyed-media/bin/ffmpeg
ENV PYTHON_PATH=/opt/render-worker-venv/bin/python

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server

RUN python3 -m venv /opt/render-worker-venv \
  && /opt/render-worker-venv/bin/pip install --no-cache-dir -r server/requirements-render-worker.txt \
  && node --version | grep -q "v${NODE_VERSION}" \
  && python3 --version | grep -q "Python ${PYTHON_VERSION}" \
  && ffmpeg -version | grep -q "ffmpeg version ${FFMPEG_VERSION}" \
  && x264 --version | grep -q "x264 0.165.3222" \
  && /opt/render-worker-venv/bin/python server/scripts/verify-render-runtime.py

CMD ["node", "server/src/renderWorker/runRenderJob.cjs"]
