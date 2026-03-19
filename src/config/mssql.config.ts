import { registerAs } from '@nestjs/config';

export default registerAs('mssql', () => ({
  server:   process.env.MSSQL_HOST     || '10.11.1.31',
  port:     parseInt(process.env.MSSQL_PORT || '1433', 10),
  user:     process.env.MSSQL_USER     || 'usr_audioETL',
  password: process.env.MSSQL_PASS     || '',
  database: process.env.MSSQL_DATABASE || 'DBC',
}));
