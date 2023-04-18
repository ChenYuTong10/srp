CREATE TABLE users
(
    id int, -- unique id
    I varchar(1024) unique, -- username
    s varchar(1024), -- random salt
    v varchar(1024), -- password verifier
    primary key (id)
);

/* show database in sqlite3 */
.database

/* show table in sqlite3 */
.tables

/* show table schema in sqlite3 */
PRAGMA table_info(users);

/* query all rows in table */
select * from users;
