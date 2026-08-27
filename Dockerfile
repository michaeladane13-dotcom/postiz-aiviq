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
RUN set -eux; \
    facebook_files="$(find /app -type f \( -name 'facebook.provider.js' -o -name 'facebook.provider.ts' \))"; \
    instagram_files="$(find /app -type f \( -name 'instagram.provider.js' -o -name 'instagram.provider.ts' \))"; \
    test -n "$facebook_files"; \
    test -n "$instagram_files"; \
    for file in $facebook_files; do \
      sed -i \
        -e "s/'pages_manage_engagement'/'pages_manage_engagement','pages_manage_metadata','pages_read_user_content'/g" \
        -e 's/"pages_manage_engagement"/"pages_manage_engagement","pages_manage_metadata","pages_read_user_content"/g' \
        "$file"; \
      grep -q 'pages_manage_metadata' "$file"; \
      grep -q 'pages_read_user_content' "$file"; \
    done; \
    for file in $instagram_files; do \
      sed -i \
        -e "s/'instagram_manage_comments'/'instagram_manage_comments','pages_manage_metadata'/g" \
        -e 's/"instagram_manage_comments"/"instagram_manage_comments","pages_manage_metadata"/g' \
        "$file"; \
      grep -q 'pages_manage_metadata' "$file"; \
    done
RUN apk add --no-cache nginx && \
    mkdir -p /run/nginx /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy
COPY nginx.conf /etc/nginx/nginx.conf
COPY legal /srv/brand-scheduler
COPY wrapper.sh /wrapper.sh
RUN chmod +x /wrapper.sh
EXPOSE 8080
CMD ["/wrapper.sh"]
