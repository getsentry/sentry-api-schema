FROM php:7.4.1-fpm

RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y git vim

# Install Composer
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

VOLUME /usr/src/output

RUN /usr/local/bin/composer require dsuurlant/response2schema
ENTRYPOINT ["/var/www/html/vendor/bin/response2schema"]
