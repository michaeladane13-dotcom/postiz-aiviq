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
    files="$(find /app -type f \( \
      -name '*.js' -o \
      -name '*.ts' -o \
      -name '*.mjs' -o \
      -name '*.cjs' \
    \) -exec grep -El 'pages_manage_engagement|instagram_manage_comments' {} + 2>/dev/null)"; \
    test -n "$files"; \
    facebook_patched=0; \
    instagram_patched=0; \
    for file in $files; do \
      if grep -Eq "identifier *= *['\"]facebook" "$file"; then \
        sed -i \
          -e "s/'pages_manage_engagement'/'pages_manage_engagement','pages_manage_metadata','pages_read_user_content'/g" \
          -e 's/"pages_manage_engagement"/"pages_manage_engagement","pages_manage_metadata","pages_read_user_content"/g' \
          "$file"; \
        facebook_patched=1; \
      fi; \
      if grep -Eq "identifier *= *['\"]instagram" "$file"; then \
        sed -i \
          -e "s/'instagram_manage_comments'/'instagram_manage_comments','pages_manage_metadata'/g" \
          -e 's/"instagram_manage_comments"/"instagram_manage_comments","pages_manage_metadata"/g' \
          "$file"; \
        instagram_patched=1; \
      fi; \
    done; \
    test "$facebook_patched" = 1; \
    test "$instagram_patched" = 1
RUN apk add --no-cache nginx && \
    mkdir -p /run/nginx /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy
COPY nginx.conf /etc/nginx/nginx.conf
COPY legal /srv/brand-scheduler
COPY wrapper.sh /wrapper.sh
RUN chmod +x /wrapper.sh
EXPOSE 8080
CMD ["/wrapper.sh"]
