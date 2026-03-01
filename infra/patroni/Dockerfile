# Patroni — PostgreSQL 高可用管理器
# 基于 postgres:16-alpine 构建，安装 Patroni + etcd3 依赖

FROM postgres:16-alpine

RUN apk add --no-cache \
      python3 \
      py3-pip \
      py3-psycopg2 \
    && pip3 install --no-cache-dir --break-system-packages \
      patroni[etcd3] \
    && rm -rf /root/.cache

COPY infra/patroni/entrypoint.sh /usr/local/bin/patroni-entrypoint.sh
COPY infra/patroni/patroni.yml   /etc/patroni/patroni.yml
COPY infra/patroni/post-init.sh  /usr/local/bin/post-init.sh

RUN chmod +x /usr/local/bin/patroni-entrypoint.sh /usr/local/bin/post-init.sh

EXPOSE 5432 8008

ENTRYPOINT ["/usr/local/bin/patroni-entrypoint.sh"]
