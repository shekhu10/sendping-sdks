//! One module per API resource. Every service struct is a cheap `Arc` clone
//! of the shared client configuration; option/response types live next to
//! the service that uses them and are re-exported flat from the crate root.

pub mod api_keys;
pub mod audiences;
pub mod automations;
pub mod campaign_types;
pub mod campaigns;
pub mod contact_properties;
pub mod contact_types;
pub mod contacts;
pub mod domains;
pub mod email_types;
pub mod emails;
pub mod events;
pub mod logs;
pub mod polls;
pub mod segments;
pub mod templates;
pub mod topics;
pub mod webhooks;

pub use api_keys::*;
pub use audiences::*;
pub use automations::*;
pub use campaign_types::*;
pub use campaigns::*;
pub use contact_properties::*;
pub use contact_types::*;
pub use contacts::*;
pub use domains::*;
pub use email_types::*;
pub use emails::*;
pub use events::*;
pub use logs::*;
pub use polls::*;
pub use segments::*;
pub use templates::*;
pub use topics::*;
pub use webhooks::*;
