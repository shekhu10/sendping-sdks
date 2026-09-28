# frozen_string_literal: true

module SendPing
  module Domains
    class << self
      # HTTPS readiness; an unavailable host schedules server-side repair.
      def tracking_health(domain_id)
        Client.request(:get, "/domains/#{Client.path_escape(domain_id)}/tracking-health")
      end

      # Register a sending domain. POST /domains
      def create(params)
        Client.request(:post, "/domains", body: params)
      end

      # GET /domains/:id
      def get(domain_id)
        Client.request(:get, "/domains/#{Client.path_escape(domain_id)}")
      end

      # GET /domains — with no pagination params one page carries up to 1,000
      # domains and `has_more` reports any truncation; pass `limit` and walk
      # `after` to read past that. Rows still pending a DNS-TXT ownership claim
      # are excluded; read those through get_claim instead.
      def list(params = {})
        Client.request(:get, "/domains", query: Client.pagination(params))
      end

      # Check a domain's live MX records before adding receiving.
      # `ours` is true only when every MX host is SendPing's. A DNS failure
      # answers { has_mx: false, ours: false, records: [] }, not an error.
      # GET /domains/mx-check?name=
      def mx_check(name)
        Client.request(:get, "/domains/mx-check", query: { name: name })
      end

      # Download the domain's DNS records as CSV text (a String, not JSON).
      # GET /domains/:id/records.csv
      def records_csv(domain_id)
        Client.request(:get, "/domains/#{Client.path_escape(domain_id)}/records.csv", raw: true)
      end

      # PATCH /domains/:id (returns the slim ack { object: "domain", id }).
      def update(domain_id, params)
        Client.request(:patch, "/domains/#{Client.path_escape(domain_id)}", body: params)
      end

      # Trigger DNS verification. POST /domains/:id/verify
      def verify(domain_id)
        Client.request(:post, "/domains/#{Client.path_escape(domain_id)}/verify")
      end

      # Claim a domain already verified in another account. POST /domains/claim
      def claim(params)
        Client.request(:post, "/domains/claim", body: params)
      end

      # Retrieve a domain's claim record. GET /domains/:id/claim
      def get_claim(domain_id)
        Client.request(:get, "/domains/#{Client.path_escape(domain_id)}/claim")
      end

      # Verify a domain claim's TXT record. POST /domains/:id/claim/verify
      def verify_claim(domain_id)
        Client.request(:post, "/domains/#{Client.path_escape(domain_id)}/claim/verify")
      end

      # Detect the DNS provider and available one-click apply methods.
      # GET /domains/:id/dns/detect
      def detect_dns(domain_id)
        Client.request(:get, "/domains/#{Client.path_escape(domain_id)}/dns/detect")
      end

      # Apply DNS records via the Cloudflare API, then auto-verify.
      # POST /domains/:id/dns/cloudflare — params: { token: "..." }
      def apply_cloudflare_dns(domain_id, params)
        Client.request(:post, "/domains/#{Client.path_escape(domain_id)}/dns/cloudflare", body: params)
      end

      # Apply DNS records via the GoDaddy API, then auto-verify.
      # POST /domains/:id/dns/godaddy — params: { key: "...", secret: "..." }
      def apply_godaddy_dns(domain_id, params)
        Client.request(:post, "/domains/#{Client.path_escape(domain_id)}/dns/godaddy", body: params)
      end

      # Apply DNS records via the Namecheap API (existing records preserved),
      # then auto-verify. POST /domains/:id/dns/namecheap
      # params: { apiUser: "...", apiKey: "...", userName: "..." } — camelCase,
      # the same spelling every SendPing SDK uses. `api_user` and `api_key`
      # are accepted aliases, and the optional username may also be spelled
      # `username`, but there is NO `user_name` alias: the API ignores that key,
      # so a username sent under it is silently dropped.
      def apply_namecheap_dns(domain_id, params)
        Client.request(:post, "/domains/#{Client.path_escape(domain_id)}/dns/namecheap", body: params)
      end

      # DELETE /domains/:id
      def delete(domain_id)
        Client.request(:delete, "/domains/#{Client.path_escape(domain_id)}")
      end
    end
  end
end
