//! `sendping.segments` — DOMAIN-REQUIRED segments. A segment belongs to a
//! sending domain's contact pool; names are unique WITHIN a domain (freely
//! reusable across domains), and every domain carries an auto-created
//! "General" (all contacts) segment.

use std::sync::Arc;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::{page_query, seg, Config};
use crate::types::{ListResponse, PaginationParams, RemovedResponse, Result};

/// Subscription-status filter of a segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SegmentStatus {
    All,
    Subscribed,
    Unsubscribed,
    /// Only contacts with an explicit membership row — the shape the CSV /
    /// Google-Sheet importers create.
    MembersOnly,
}

/// The engagement signal an engagement-scoped segment matches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EngagementEvent {
    Clicked,
    NotClicked,
    Opened,
    NotOpened,
}

/// Narrow a segment to contacts who did (or did not) engage with one campaign.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SegmentEngagement {
    pub event: EngagementEvent,
    pub campaign_id: String,
}

impl SegmentEngagement {
    pub fn new(event: EngagementEvent, campaign_id: impl Into<String>) -> Self {
        Self {
            event,
            campaign_id: campaign_id.into(),
        }
    }
}

/// Operator for a custom-property segment predicate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PropertyOperator {
    Eq,
    Contains,
    Exists,
}

/// A single custom-property predicate. `value` is required for
/// `eq`/`contains` (use the constructors).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyFilter {
    pub key: String,
    pub operator: PropertyOperator,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}

impl PropertyFilter {
    /// `property == value`
    pub fn eq(key: impl Into<String>, value: impl Into<Value>) -> Self {
        Self {
            key: key.into(),
            operator: PropertyOperator::Eq,
            value: Some(value.into()),
        }
    }

    /// `property contains value`
    pub fn contains(key: impl Into<String>, value: impl Into<Value>) -> Self {
        Self {
            key: key.into(),
            operator: PropertyOperator::Contains,
            value: Some(value.into()),
        }
    }

    /// `property exists`
    pub fn exists(key: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            operator: PropertyOperator::Exists,
            value: None,
        }
    }
}

/// A segment's filter as returned by the API.
#[derive(Debug, Clone, Deserialize)]
pub struct SegmentFilter {
    pub status: SegmentStatus,
    pub email_contains: Option<String>,
    #[serde(default)]
    pub property_filters: Vec<PropertyFilter>,
    /// Campaign-engagement narrowing, when set.
    pub engagement: Option<SegmentEngagement>,
}

/// A segment.
#[derive(Debug, Clone, Deserialize)]
pub struct Segment {
    pub object: String,
    pub id: String,
    pub audience_id: String,
    pub name: String,
    pub filter: SegmentFilter,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// A row of `segments.contacts()` — the REDUCED contact shape the resolver
/// returns (no `object`, no `properties`); use `contacts.get(..)` for the
/// full [`Contact`](crate::services::contact_types::Contact).
#[derive(Debug, Clone, Deserialize)]
pub struct SegmentContact {
    pub id: String,
    pub email: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    #[serde(default)]
    pub unsubscribed: bool,
    pub created_at: Option<String>,
}

/// Filter accepted on segment create/update.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SegmentFilterOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SegmentStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email_contains: Option<String>,
    /// Replace the property predicates; an empty vec clears them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub property_filters: Option<Vec<PropertyFilter>>,
    /// Narrow to contacts who did (or did not) engage with one campaign;
    /// `Some(None)` serializes as `null` (clears the predicate).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engagement: Option<Option<SegmentEngagement>>,
}

impl SegmentFilterOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_status(mut self, status: SegmentStatus) -> Self {
        self.status = Some(status);
        self
    }

    pub fn with_email_contains(mut self, email_contains: impl Into<String>) -> Self {
        self.email_contains = Some(email_contains.into());
        self
    }

    pub fn with_property_filter(mut self, filter: PropertyFilter) -> Self {
        self.property_filters
            .get_or_insert_with(Vec::new)
            .push(filter);
        self
    }

    /// Narrow to contacts who did (or did not) engage with one campaign.
    pub fn with_engagement(mut self, engagement: SegmentEngagement) -> Self {
        self.engagement = Some(Some(engagement));
        self
    }

    /// Clear the engagement predicate (serializes `engagement: null`).
    pub fn clear_engagement(mut self) -> Self {
        self.engagement = Some(None);
        self
    }

    /// Clear the property predicates (serializes `property_filters: []`).
    pub fn clear_property_filters(mut self) -> Self {
        self.property_filters = Some(Vec::new());
        self
    }
}

/// Options for `segments.create` (`POST /segments`).
///
/// ```no_run
/// use sendping::CreateSegmentOptions;
/// let segment = CreateSegmentOptions::new("yourdomain.com", "VIP");
/// ```
#[derive(Debug, Clone, Serialize)]
pub struct CreateSegmentOptions {
    /// REQUIRED. The sending domain this segment belongs to (one of your
    /// domains — replaces the retired `audience_id`).
    pub domain: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<SegmentFilterOptions>,
}

impl CreateSegmentOptions {
    pub fn new(domain: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            domain: domain.into(),
            name: name.into(),
            filter: None,
        }
    }

    pub fn with_filter(mut self, filter: SegmentFilterOptions) -> Self {
        self.filter = Some(filter);
        self
    }
}

/// Options for `segments.update` (`PATCH /segments/:id`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateSegmentOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<SegmentFilterOptions>,
}

impl UpdateSegmentOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_filter(mut self, filter: SegmentFilterOptions) -> Self {
        self.filter = Some(filter);
        self
    }
}

/// Params for `segments.list` — domain-scoped (`domain` is REQUIRED).
#[derive(Debug, Clone)]
pub struct ListSegmentsParams {
    /// REQUIRED. The sending domain whose segments to list.
    pub domain: String,
    pub limit: Option<u32>,
    pub after: Option<String>,
    pub before: Option<String>,
}

impl ListSegmentsParams {
    pub fn new(domain: impl Into<String>) -> Self {
        Self {
            domain: domain.into(),
            limit: None,
            after: None,
            before: None,
        }
    }

    pub fn with_limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    pub fn with_after(mut self, after: impl Into<String>) -> Self {
        self.after = Some(after.into());
        self
    }

    pub fn with_before(mut self, before: impl Into<String>) -> Self {
        self.before = Some(before.into());
        self
    }
}

/// `sendping.segments`.
#[derive(Clone, Debug)]
pub struct SegmentsSvc {
    config: Arc<Config>,
}

impl SegmentsSvc {
    pub(crate) fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    /// Create a segment on a sending domain (`domain` required). `POST /segments`
    pub async fn create(&self, options: CreateSegmentOptions) -> Result<Segment> {
        self.config
            .send(
                self.config
                    .request(Method::POST, "/segments")
                    .json(&options),
            )
            .await
    }

    /// Retrieve a segment. `GET /segments/:id`
    pub async fn get(&self, segment_id: &str) -> Result<Segment> {
        let path = format!("/segments/{}", seg(segment_id));
        self.config
            .send(self.config.request(Method::GET, &path))
            .await
    }

    /// List a domain's segments (includes its auto-created "General"
    /// segment). `GET /segments?domain=`
    pub async fn list(&self, params: ListSegmentsParams) -> Result<ListResponse<Segment>> {
        let mut query: Vec<(&str, String)> = vec![("domain", params.domain.clone())];
        if let Some(limit) = params.limit {
            query.push(("limit", limit.to_string()));
        }
        if let Some(after) = &params.after {
            query.push(("after", after.clone()));
        }
        if let Some(before) = &params.before {
            query.push(("before", before.clone()));
        }
        self.config
            .send(self.config.request(Method::GET, "/segments").query(&query))
            .await
    }

    /// Preview the contacts a segment currently resolves to (filter matches ∪
    /// explicit memberships). Rows are the reduced [`SegmentContact`] shape.
    ///
    /// With no `limit` and no `after` cursor the route returns as much of the
    /// membership as fits in ONE page, capped at **1,000** rows — a segment
    /// larger than that is truncated, and `has_more` says so. Do not treat an
    /// unpaginated call as the whole membership: keep walking with
    /// `with_after(last_id)` while `has_more` is true.
    /// `GET /segments/:id/contacts`
    pub async fn contacts(
        &self,
        segment_id: &str,
        params: Option<PaginationParams>,
    ) -> Result<ListResponse<SegmentContact>> {
        let path = format!("/segments/{}/contacts", seg(segment_id));
        let req = self
            .config
            .request(Method::GET, &path)
            .query(&page_query(params.as_ref()));
        self.config.send(req).await
    }

    /// Update a segment. `PATCH /segments/:id`
    pub async fn update(&self, segment_id: &str, options: UpdateSegmentOptions) -> Result<Segment> {
        let path = format!("/segments/{}", seg(segment_id));
        self.config
            .send(self.config.request(Method::PATCH, &path).json(&options))
            .await
    }

    /// Delete a segment. `DELETE /segments/:id`
    pub async fn remove(&self, segment_id: &str) -> Result<RemovedResponse> {
        let path = format!("/segments/{}", seg(segment_id));
        self.config
            .send(self.config.request(Method::DELETE, &path))
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segment_status_round_trips_every_wire_value() {
        // `members_only` is what the CSV / Google-Sheet importers create, so a
        // missing variant makes `segments.get` fail to decode.
        for (value, expected) in [
            ("all", SegmentStatus::All),
            ("subscribed", SegmentStatus::Subscribed),
            ("unsubscribed", SegmentStatus::Unsubscribed),
            ("members_only", SegmentStatus::MembersOnly),
        ] {
            let parsed: SegmentStatus =
                serde_json::from_str(&format!("\"{value}\"")).expect("status should parse");
            assert_eq!(parsed, expected);
            assert_eq!(
                serde_json::to_string(&expected).unwrap(),
                format!("\"{value}\"")
            );
        }
    }

    #[test]
    fn segment_decodes_engagement_and_null_timestamps() {
        let segment: Segment = serde_json::from_str(
            r#"{"object":"segment","id":"seg_1","audience_id":"aud_1","name":"Clickers",
                "filter":{"status":"members_only","email_contains":null,"property_filters":[],
                          "engagement":{"event":"not_clicked","campaign_id":"cmp_1"}},
                "created_at":null,"updated_at":null}"#,
        )
        .expect("segment should decode");

        assert_eq!(segment.filter.status, SegmentStatus::MembersOnly);
        assert_eq!(
            segment.filter.engagement,
            Some(SegmentEngagement::new(EngagementEvent::NotClicked, "cmp_1"))
        );
        assert!(segment.created_at.is_none());
    }

    #[test]
    fn engagement_filter_serializes_snake_case_campaign_id() {
        let filter = SegmentFilterOptions::new()
            .with_status(SegmentStatus::MembersOnly)
            .with_engagement(SegmentEngagement::new(EngagementEvent::Opened, "cmp_9"));
        let json = serde_json::to_string(&filter).unwrap();
        assert!(json.contains(r#""status":"members_only""#), "got: {json}");
        assert!(
            json.contains(r#""engagement":{"event":"opened","campaign_id":"cmp_9"}"#),
            "got: {json}"
        );
    }
}
