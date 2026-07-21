CREATE TABLE employees (
  emp_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  salary INTEGER NOT NULL
);

INSERT INTO employees (emp_id, name, department, salary) VALUES
  (1,  'Alice Chen',      'Engineering', 95000),
  (2,  'Bob Martinez',    'Engineering', 90000),
  (3,  'Carol Nguyen',    'Engineering', 90000),
  (4,  'Dave Okafor',     'Engineering', 88000),
  (5,  'Eve Patel',       'Engineering', 85000),
  (6,  'Frank Lee',       'Sales',       82000),
  (7,  'Grace Kim',       'Sales',       82000),
  (8,  'Heidi Wagner',    'Sales',       82000),
  (9,  'Ivan Petrov',     'Sales',       79000),
  (10, 'Judy Alvarez',    'Marketing',   91000),
  (11, 'Mallory Singh',   'Marketing',   91000),
  (12, 'Niaj Rahman',     'Marketing',   87000),
  (13, 'Olivia Brooks',   'Marketing',   84000),
  (14, 'Peggy Torres',    'Marketing',   84000),
  (15, 'Sybil Costa',     'Marketing',   80000);
