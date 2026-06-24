FROM ghcr.io/gitroomhq/postiz-app:v2.11.3
USER root
RUN apk add --no-cache nginx && \
    sed -i 's/^user nginx;/user root;/' /etc/nginx/nginx.conf && \
    mkdir -p /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy /run/nginx
RUN rm -f /etc/nginx/http.d/default.conf
COPY nginx-internal.conf /etc/nginx/http.d/postiz.conf
COPY wrapper.sh /wrapper.sh
RUN chmod +x /wrapper.sh
EXPOSE 8080
CMD ["/wrapper.sh"]
