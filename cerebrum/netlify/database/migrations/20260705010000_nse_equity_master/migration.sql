-- Local mirror of NSE's official listed-equities master (symbol + company
-- name + ISIN for every NSE-listed security), downloaded from
-- https://archives.nseindia.com/content/equities/EQUITY_L.csv. Lets ticker
-- resolution (autocomplete when adding a stock, symbol lookup for
-- news/sparklines) happen as an instant local query instead of depending on
-- a live indianapi.in call every time.

create table if not exists nse_equity_master (
  symbol text primary key,
  company_name text not null,
  isin text,
  series text,
  updated_at timestamptz default now()
);

create index if not exists idx_nse_equity_master_company_name on nse_equity_master (lower(company_name));
