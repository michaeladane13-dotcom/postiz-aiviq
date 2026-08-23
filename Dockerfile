FROM ghcr.io/gitroomhq/postiz-app:v2.11.3
USER root
RUN set -eux; \
    files="$(find /app -type f \( \
      -name '*.js' -o \
      -name '*.ts' -o \
      -name '*.mjs' -o \
      -name '*.cjs' -o \
      -name '*.map' \
    \) -exec grep -El 'instagram_manage_insights|read_insights' {} + 2>/dev/null)"; \
    test -n "$files"; \
    for file in $files; do \
      sed -i \
        -e 's/instagram_manage_insights/instagram_content_publish/g' \
        -e 's/read_insights/pages_read_engagement/g' \
        "$file"; \
    done; \
    test -z "$(find /app -type f \( \
      -name '*.js' -o \
      -name '*.ts' -o \
      -name '*.mjs' -o \
      -name '*.cjs' -o \
      -name '*.map' \
    \) -exec grep -El 'instagram_manage_insights|read_insights' {} + 2>/dev/null)"
RUN apk add --no-cache nginx && \
    mkdir -p /run/nginx /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy
COPY nginx.conf /etc/nginx/nginx.conf
COPY legal /srv/brand-scheduler
COPY wrapper.sh /wrapper.sh
RUN chmod +x /wrapper.sh
EXPOSE 8080
CMD ["/wrapper.sh"]
