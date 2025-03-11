docker run --name mysql-container -d \
  -e MYSQL_ROOT_PASSWORD=your_password \
  -e MYSQL_DATABASE=your_database \
  -p 3306:3306 \
  mariadb:latest
