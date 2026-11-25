-- 0175: the address of the public booking page, kept in Booking settings as the Shop keeps its own (0157).
-- The emails to a requestor link to it ("see your booking"), so the link follows the site wherever it is served.

alter table booking.settings
  add column if not exists site_url text not null default 'https://book.littlearkfoundation.org'
    check (site_url ~ '^https?://[a-z0-9.:-]+$' and length(site_url) <= 120);

comment on column booking.settings.site_url is 'Where the public booking page is served, without a trailing slash. Used for the links in emails.';
