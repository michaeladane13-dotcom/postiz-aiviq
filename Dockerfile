FROM ghcr.io/gitroomhq/postiz-app:v2.11.3
USER root
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*
RUN rm -f /etc/nginx/sites-enabled/default
COPY nginx-internal.conf /etc/nginx/conf.d/default.conf
COPY wrapper.sh /wrapper.sh
RUN chmod +x /wrapper.sh
EXPOSE 8080
CMD ["/wrapper.sh"]
