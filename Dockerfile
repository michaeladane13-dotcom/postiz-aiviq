FROM ghcr.io/gitroomhq/postiz-app:v2.23.0
USER root
# The 2.23 image already contains nginx and the complete Postiz runtime.  Keep
# this wrapper intentionally small so upstream layout changes cannot break the
# Railway build; our config only adds the legal routes and Railway's dynamic
# public port.
RUN mkdir -p /run/nginx /var/lib/nginx/tmp/client_body /var/lib/nginx/tmp/proxy
COPY nginx.conf /etc/nginx/nginx.conf
COPY legal /srv/brand-scheduler
COPY wrapper.sh /wrapper.sh
RUN chmod +x /wrapper.sh
EXPOSE 8080
CMD ["/wrapper.sh"]
