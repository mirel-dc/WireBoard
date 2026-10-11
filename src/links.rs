use crate::{error::AppError, model::valid_id};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_LINK_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LinkIndex {
    version: u32,
    // Deleted board IDs remain reserved so an old link cannot change owners.
    boards: BTreeMap<String, String>,
}
impl Default for LinkIndex {
    fn default() -> Self {
        Self {
            version: 1,
            boards: BTreeMap::new(),
        }
    }
}
impl LinkIndex {
    pub fn decode(bytes: &[u8]) -> Result<Self, AppError> {
        let index: Self = serde_json::from_slice(bytes).map_err(|_| {
            AppError::validation("Повреждённый индекс ссылок. Исходный файл сохранён")
        })?;
        let mut unique = BTreeSet::new();
        if index.version != 1
            || index
                .boards
                .iter()
                .any(|(id, slug)| !valid_id(id) || !valid_slug(slug) || !unique.insert(slug))
        {
            return Err(AppError::validation(
                "Некорректный индекс ссылок. Исходный файл сохранён",
            ));
        }
        Ok(index)
    }
    pub fn encode(&self) -> Result<Vec<u8>, AppError> {
        let mut bytes = serde_json::to_vec_pretty(self).map_err(|_| AppError::persistence())?;
        bytes.push(b'\n');
        if bytes.len() > MAX_LINK_BYTES {
            return Err(AppError::limit("Индекс ссылок больше 32 MiB"));
        }
        Ok(bytes)
    }
    pub fn slug(&self, id: &str) -> Option<&str> {
        self.boards.get(id).map(String::as_str)
    }
    pub fn assign(&mut self, id: &str, title: &str) {
        if self.boards.contains_key(id) {
            return;
        }
        let base = title_slug(title);
        let mut slug = base.clone();
        let mut number = 2;
        while self.boards.values().any(|existing| existing == &slug) {
            slug = format!("{base}-{number}");
            number += 1;
        }
        self.boards.insert(id.to_string(), slug);
    }
}

pub(crate) fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 128
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--")
        && slug
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

fn title_slug(title: &str) -> String {
    let mut result = String::new();
    for ch in title.to_lowercase().chars() {
        let letters = match ch {
            'а' => "a",
            'б' => "b",
            'в' => "v",
            'г' => "g",
            'д' => "d",
            'е' => "e",
            'ё' => "yo",
            'ж' => "zh",
            'з' => "z",
            'и' => "i",
            'й' => "y",
            'к' => "k",
            'л' => "l",
            'м' => "m",
            'н' => "n",
            'о' => "o",
            'п' => "p",
            'р' => "r",
            'с' => "s",
            'т' => "t",
            'у' => "u",
            'ф' => "f",
            'х' => "kh",
            'ц' => "ts",
            'ч' => "ch",
            'ш' => "sh",
            'щ' => "shch",
            'ъ' | 'ь' => "",
            'ы' => "y",
            'э' => "e",
            'ю' => "yu",
            'я' => "ya",
            _ => {
                if ch.is_ascii_alphanumeric() {
                    result.push(ch);
                } else if !result.is_empty() && !result.ends_with('-') {
                    result.push('-');
                }
                continue;
            }
        };
        result.push_str(letters);
    }
    result.truncate(80);
    let result = result.trim_matches('-');
    if result.is_empty() {
        "doska".to_string()
    } else {
        result.to_string()
    }
}
