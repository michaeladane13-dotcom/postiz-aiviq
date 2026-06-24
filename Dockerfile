FROM ghcr.io/gitroomhq/postiz-app:v2.11.3
USER root
RUN apk add --no-cache nginx && \
    mkdir -p /run/nginx /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy
COPY nginx.conf /etc/nginx/nginx.conf
COPY wrapper.sh /wrapper.sh
RUN chmod +x /wrapper.sh
EXPOSE 8080
CMD ["/wrapper.sh"]
